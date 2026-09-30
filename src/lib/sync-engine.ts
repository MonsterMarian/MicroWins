import { mergeIntoAccount, type AccountMerge } from "./account-merge";
import {
  applyRecords,
  diffStates,
  fromRecords,
  isEmptyState,
  isStateRecordKind,
  parseRecordId,
  recordFromState,
  recordId,
  type SyncRecord,
} from "./sync";
import type { MicroWinsState } from "./types";

/**
 * Synchronizace - řízení: co kdy stáhnout, co odeslat a jak do účtu dostat
 * data, která v telefonu byla dřív než účet.
 *
 * Síť, úložiště i stav appky dostává zvenku (`SyncDeps`), takže se dá celá
 * vyzkoušet proti serveru v paměti se dvěma "telefony" - viz
 * `sync-engine.test.ts`. Skutečné napojení je v `sync-runtime.ts`.
 *
 * Pravidla v kostce:
 *
 * - **Deník změn.** Každá změna stavu zapíše do fronty `druh:klíč → čas`.
 *   Odesílá se až při synchronizaci a vždy aktuální podoba záznamu, takže
 *   deset úprav téže položky odejde jako jedna.
 * - **Nejdřív stáhnout, pak odeslat.** Co přijde z účtu a je novější než
 *   neodeslaná změna v telefonu, vyhraje; starší se přeskočí a přepíše ji
 *   odeslání. Server to hlídá taky (`push_records` nepřepíše novější).
 * - **Změny ze sítě se do deníku nepíšou** - jinak by se každá stažená věc
 *   hned zase odeslala.
 * - **Deník běží i po odhlášení**, dokud data patří účtu. Co se v telefonu
 *   změní bez přihlášení, odejde po dalším přihlášení.
 */

export interface RemoteRow {
  kind: string;
  key: string;
  data: unknown;
  changed_at: string;
  updated_at: string;
}

export interface OutgoingRow {
  kind: string;
  key: string;
  data: unknown;
  changed_at: string;
}

export interface SyncTransport {
  /**
   * Záznamy účtu změněné po `since` (bez udání všechny), seřazené podle
   * příchodu. `onProgress` dostává, kolik už dorazilo a kolik jich je celkem
   * (když to server řekne).
   */
  pull(
    since: string | null,
    onProgress?: (done: number, total: number | null) => void,
  ): Promise<RemoteRow[]>;
  push(rows: OutgoingRow[]): Promise<void>;
}

/** Kolik se toho zrovna stahuje nebo nahrává - pro pruh na obrazovce. */
export interface SyncProgress {
  direction: "down" | "up";
  done: number;
  /** null = server počet neřekl. */
  total: number | null;
}

export interface SyncMeta {
  /** Účet, kterému data v zařízení patří; null = data bez účtu. */
  owner: string | null;
  /** Čas příchodu posledního staženého záznamu (serverový). */
  cursor: string | null;
  /** Neodeslané změny: `druh:klíč` → kdy se změnily. */
  outbox: Record<string, string>;
}

export interface SyncDeps {
  transport: SyncTransport;
  loadMeta(): SyncMeta;
  saveMeta(meta: SyncMeta): void;
  getState(): MicroWinsState;
  /** Nahradí stav appky **bez** zápisu do deníku. */
  replaceState(next: MicroWinsState): void;
  now(): Date;
  /** Průběh přenosu; `null` = hotovo. */
  onProgress?(progress: SyncProgress | null): void;
  /**
   * Záznamy, které nejsou ve stavu appky - nastavení. Motor je jen přenáší:
   * `extraRecords` = všechny, jak jsou v zařízení teď (první nahrání do
   * účtu), `readExtra` = jeden k odeslání z fronty, `applyExtra` = propsat
   * stažené (bez zápisu do deníku). Bez nich se synchronizují jen data.
   */
  extraRecords?(): SyncRecord[];
  readExtra?(kind: string, key: string): SyncRecord | null;
  applyExtra?(records: SyncRecord[]): void;
}

/**
 * Jak naložit s daty v zařízení po přihlášení (DATABAZE.md, kap. 5).
 *
 * - `fresh`: v zařízení nic není - převezme se účet a není se na co ptát.
 * - `merge`: data bez účtu (nebo z dřívějška tohoto účtu) - spojí se s účtem.
 * - `foreign`: data patří **jinému** účtu - samo se nic neslučuje.
 */
export type AdoptionPlan = (
  | { kind: "fresh"; userId: string; account: MicroWinsState; cursor: string | null }
  | {
      kind: "merge";
      userId: string;
      account: MicroWinsState;
      local: MicroWinsState;
      merged: AccountMerge;
      cursor: string | null;
    }
  | {
      kind: "foreign";
      userId: string;
      owner: string;
      account: MicroWinsState;
      local: MicroWinsState;
      cursor: string | null;
    }
) & {
  /**
   * Nastavení uložené v účtu. Prázdné = účet ho ještě nemá a vezme si ho
   * z tohohle zařízení; jinak vyhrává účet - je to to, co už vidí ostatní
   * zařízení.
   */
  extras: SyncRecord[];
};

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  /** Změnil se stav v zařízení? */
  applied: boolean;
}

/**
 * Stahuje se s přesahem - záznamy odeslané ve stejné chvíli, kdy běželo
 * stahování, můžou dostat serverový čas o chlup starší než kurzor. Minuta
 * navíc je pojistka; co už v telefonu je, se znovu nepropíše (nic se nemění).
 */
export const PULL_OVERLAP_MS = 60_000;

/** Kolik řádků jde na server jedním voláním. */
export const PUSH_BATCH = 500;

function toRecords(rows: readonly RemoteRow[]): SyncRecord[] {
  return rows.map((r) => ({ kind: r.kind as SyncRecord["kind"], key: r.key, data: r.data }));
}

function latest(rows: readonly RemoteRow[], cursor: string | null): string | null {
  let best = cursor;
  for (const r of rows) {
    if (best === null || Date.parse(r.updated_at) > Date.parse(best)) best = r.updated_at;
  }
  return best;
}

export class SyncEngine {
  constructor(private readonly deps: SyncDeps) {}

  owner(): string | null {
    return this.deps.loadMeta().owner;
  }

  pending(): number {
    return Object.keys(this.deps.loadMeta().outbox).length;
  }

  /**
   * Zapíše do deníku změnu mimo stav appky (nastavení) - `ids` jsou
   * `druh:klíč`. Stejně jako u dat: bez účtu se nezapisuje nic.
   */
  touch(ids: readonly string[]): number {
    const meta = this.deps.loadMeta();
    if (meta.owner === null || ids.length === 0) return 0;
    const at = this.deps.now().toISOString();
    const outbox = { ...meta.outbox };
    for (const id of ids) outbox[id] = at;
    this.deps.saveMeta({ ...meta, outbox });
    return ids.length;
  }

  /** Zapíše změnu stavu do deníku. Data bez účtu se nezapisují - převezmou se celá. */
  journal(prev: MicroWinsState, next: MicroWinsState): number {
    if (prev === next) return 0;
    const meta = this.deps.loadMeta();
    if (meta.owner === null) return 0;
    const changes = diffStates(prev, next);
    if (changes.length === 0) return 0;
    const at = this.deps.now().toISOString();
    const outbox = { ...meta.outbox };
    for (const c of changes) outbox[recordId(c.kind, c.key)] = at;
    this.deps.saveMeta({ ...meta, outbox });
    return changes.length;
  }

  /**
   * Po přihlášení: stáhne celý účet a řekne, co s daty v zařízení. Když už
   * data tomuhle účtu patří, převzetí není potřeba (`null`).
   */
  async planAdoption(userId: string): Promise<AdoptionPlan | null> {
    const meta = this.deps.loadMeta();
    if (meta.owner === userId) return null;

    const rows = await this.pullReporting(null);
    const records = toRecords(rows);
    const account = fromRecords(records.filter((r) => isStateRecordKind(r.kind)));
    const extras = records.filter((r) => !isStateRecordKind(r.kind) && r.data !== null);
    const cursor = latest(rows, null);
    const local = this.deps.getState();

    if (isEmptyState(local)) return { kind: "fresh", userId, account, cursor, extras };
    if (meta.owner !== null) {
      return { kind: "foreign", userId, owner: meta.owner, account, local, cursor, extras };
    }
    return {
      kind: "merge",
      userId,
      account,
      local,
      merged: mergeIntoAccount(account, local),
      cursor,
      extras,
    };
  }

  /**
   * Provede převzetí. `merge` data spojí a do účtu odešle jen to, co v něm
   * chybí nebo co se liší; ostatní plány převezmou účet tak, jak je.
   *
   * Stav v zařízení se přepíše až po úspěšném odeslání - když spadne síť,
   * v telefonu zůstane všechno, jak bylo, a převzetí jde pustit znovu.
   */
  async adopt(plan: AdoptionPlan): Promise<void> {
    const at = this.deps.now().toISOString();
    const rows: OutgoingRow[] = [];
    let next = plan.account;
    if (plan.kind === "merge") {
      // Slučuje se znovu s tím, co v zařízení je teď - dialog mohl být
      // otevřený déle a mezitím něco přibylo.
      next = mergeIntoAccount(plan.account, this.deps.getState()).state;
      rows.push(...diffStates(plan.account, next).map((r) => ({ ...r, changed_at: at })));
    }
    // Nastavení: účet, který ho ještě nemá, si ho vezme odsud.
    if (plan.extras.length === 0) {
      rows.push(...(this.deps.extraRecords?.() ?? []).map((r) => ({ ...r, changed_at: at })));
    }
    await this.pushAll(rows);

    // Až po úspěšném odeslání - jinak zůstane zařízení, jak bylo.
    this.deps.replaceState(next);
    if (plan.extras.length > 0) this.deps.applyExtra?.(plan.extras);
    this.deps.saveMeta({ owner: plan.userId, cursor: plan.cursor, outbox: {} });
  }

  /** Jedno kolo: stáhnout novinky, propsat je, odeslat frontu. */
  async sync(): Promise<SyncOutcome> {
    const meta = this.deps.loadMeta();
    const since = meta.cursor
      ? new Date(Date.parse(meta.cursor) - PULL_OVERLAP_MS).toISOString()
      : null;
    const rows = await this.pullReporting(since);

    // Stažené, novější než neodeslaná změna v telefonu, frontu vyřadí.
    const outbox = { ...this.deps.loadMeta().outbox };
    const stamps = new Map(rows.map((r) => [recordId(r.kind, r.key), Date.parse(r.changed_at)]));
    const accept = (r: SyncRecord) => {
      const id = recordId(r.kind, r.key);
      const mine = outbox[id];
      if (mine === undefined) return true;
      if ((stamps.get(id) ?? 0) > Date.parse(mine)) {
        delete outbox[id];
        return true;
      }
      return false;
    };

    const records = toRecords(rows);
    const current = this.deps.getState();
    const next = applyRecords(
      current,
      records.filter((r) => isStateRecordKind(r.kind)),
      accept,
    );
    const applied = next !== current;
    if (applied) this.deps.replaceState(next);
    const extras = records.filter((r) => !isStateRecordKind(r.kind) && accept(r));
    if (extras.length > 0) this.deps.applyExtra?.(extras);

    const cursor = latest(rows, meta.cursor);
    // Mezitím mohla přibýt další změna - bere se čerstvá fronta, jen bez
    // toho, co přebilo stažené.
    const fresh = this.deps.loadMeta().outbox;
    const merged: Record<string, string> = {};
    for (const [id, at] of Object.entries(fresh)) {
      if (id in outbox || at !== meta.outbox[id]) merged[id] = at;
    }
    this.deps.saveMeta({ ...this.deps.loadMeta(), cursor, outbox: merged });

    const pushed = await this.pushOutbox();
    return { pulled: rows.length, pushed, applied };
  }

  private async pushOutbox(): Promise<number> {
    const snapshot = { ...this.deps.loadMeta().outbox };
    const entries = Object.entries(snapshot);
    if (entries.length === 0) return 0;

    const state = this.deps.getState();
    const rows: OutgoingRow[] = [];
    for (const [id, at] of entries) {
      const { kind, key } = parseRecordId(id);
      const record =
        recordFromState(state, kind, key) ?? this.deps.readExtra?.(kind, key) ?? null;
      if (record) rows.push({ ...record, changed_at: at });
    }
    await this.pushAll(rows);

    // Odeslané pryč; co se během odesílání změnilo znovu, ve frontě zůstane.
    const meta = this.deps.loadMeta();
    const outbox = { ...meta.outbox };
    for (const [id, at] of entries) if (outbox[id] === at) delete outbox[id];
    this.deps.saveMeta({ ...meta, outbox });
    return rows.length;
  }

  private async pullReporting(since: string | null): Promise<RemoteRow[]> {
    const report = this.deps.onProgress;
    try {
      return await this.deps.transport.pull(since, (done, total) =>
        report?.({ direction: "down", done, total }),
      );
    } finally {
      report?.(null);
    }
  }

  private async pushAll(rows: OutgoingRow[]): Promise<void> {
    const report = this.deps.onProgress;
    try {
      for (let i = 0; i < rows.length; i += PUSH_BATCH) {
        report?.({ direction: "up", done: i, total: rows.length });
        await this.deps.transport.push(rows.slice(i, i + PUSH_BATCH));
      }
      if (rows.length > 0) report?.({ direction: "up", done: rows.length, total: rows.length });
    } finally {
      report?.(null);
    }
  }
}
