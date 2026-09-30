import { recordKey, same } from "./account-merge";
import type { StateKey } from "./parts";
import { parseState } from "./storage";
import { EMPTY_STATE, type MicroWinsState, type TreeNode } from "./types";

/**
 * Synchronizace - čistá část: stav jako záznamy a zpátky.
 *
 * V databázi je jeden řádek na záznam (`supabase/schema.sql`): projekt, úkol,
 * položka ToDo, list time boxu … každý zvlášť pod klíčem `druh:id`. Díky tomu
 * se konflikty řeší po záznamech - dva telefony, které offline měnily různé
 * věci, si obě změny nechají.
 *
 * Jedna věc v záznamech nežije: **pořadí ve stromu**. To je pořadí v poli
 * `nodes` a samotné uzly o něm nevědí - přetažení složky nezmění ani jeden
 * uzel, jen pole. Proto má vlastní záznam `nodeOrder:nodes` se seznamem id.
 *
 * Síť, localStorage ani React tu nejsou - viz `sync.test.ts`.
 */

export const SYNC_KINDS: readonly StateKey[] = [
  "nodes",
  "entries",
  "microwins",
  "projects",
  "tasks",
  "milestones",
  "snapshots",
  "taskSnapshots",
  "todos",
  "timeBlocks",
  "daySheets",
];

export const NODE_ORDER_KIND = "nodeOrder";
export const NODE_ORDER_KEY = "nodes";

export type RecordKind = StateKey | typeof NODE_ORDER_KIND;

export interface SyncRecord {
  kind: RecordKind;
  key: string;
  /** Záznam, jak ho zná appka; `null` = smazaný (náhrobek). */
  data: unknown;
}

/** Jednoznačný klíč záznamu napříč druhy - stejný tvar jako `stampKey`. */
export function recordId(kind: string, key: string): string {
  return `${kind}:${key}`;
}

export function parseRecordId(id: string): { kind: string; key: string } {
  const at = id.indexOf(":");
  return { kind: id.slice(0, at), key: id.slice(at + 1) };
}

function isSyncKind(kind: string): kind is StateKey {
  return (SYNC_KINDS as readonly string[]).includes(kind);
}

function keyed(kind: StateKey, items: readonly unknown[]): Map<string, unknown> {
  return new Map(items.map((r) => [recordKey(kind, r as never), r]));
}

/** Celý stav jako záznamy - pro první nahrání do prázdného účtu. */
export function toRecords(state: MicroWinsState): SyncRecord[] {
  const out: SyncRecord[] = [];
  for (const kind of SYNC_KINDS) {
    for (const item of state[kind]) {
      out.push({ kind, key: recordKey(kind, item as never), data: item });
    }
  }
  if (state.nodes.length > 0) {
    out.push({ kind: NODE_ORDER_KIND, key: NODE_ORDER_KEY, data: state.nodes.map((n) => n.id) });
  }
  return out;
}

/**
 * Co se mezi dvěma stavy změnilo. Kolekce se stejnou identitou pole se ani
 * neprochází - akce mění jen to, na co sáhly, takže běžná změna projde
 * jednu kolekci. Nový objekt se stejným obsahem (přečíslování pořadí) za
 * změnu nepočítá.
 */
export function diffStates(prev: MicroWinsState, next: MicroWinsState): SyncRecord[] {
  const out: SyncRecord[] = [];
  for (const kind of SYNC_KINDS) {
    if (prev[kind] === next[kind]) continue;
    const before = keyed(kind, prev[kind]);
    const after = keyed(kind, next[kind]);
    for (const [key, item] of after) {
      const old = before.get(key);
      if (old === item || (old !== undefined && same(old, item))) continue;
      out.push({ kind, key, data: item });
    }
    for (const key of before.keys()) {
      if (!after.has(key)) out.push({ kind, key, data: null });
    }
  }
  if (prev.nodes !== next.nodes && !sameOrder(prev.nodes, next.nodes)) {
    out.push({ kind: NODE_ORDER_KIND, key: NODE_ORDER_KEY, data: next.nodes.map((n) => n.id) });
  }
  return out;
}

function sameOrder(a: readonly TreeNode[], b: readonly TreeNode[]): boolean {
  return a.length === b.length && a.every((n, i) => n.id === b[i].id);
}

/** Aktuální podoba záznamu ve stavu - co se má odeslat. Chybí-li, je smazaný. */
export function recordFromState(state: MicroWinsState, kind: string, key: string): SyncRecord | null {
  if (kind === NODE_ORDER_KIND) {
    return { kind, key, data: state.nodes.map((n) => n.id) };
  }
  if (!isSyncKind(kind)) return null;
  const item = (state[kind] as readonly unknown[]).find((r) => recordKey(kind, r as never) === key);
  return { kind, key, data: item ?? null };
}

/**
 * Propíše záznamy z účtu do stavu. Nový záznam přibude na konec, změněný se
 * vymění na svém místě, náhrobek záznam smaže. `accept` může záznam odmítnout
 * - třeba když má telefon novější neodeslanou změnu.
 *
 * Když se nic nezměnilo, vrací **tentýž** stav - volající podle toho pozná,
 * že nemá co ukládat ani překreslovat.
 */
export function applyRecords(
  state: MicroWinsState,
  records: readonly SyncRecord[],
  accept: (record: SyncRecord) => boolean = () => true,
): MicroWinsState {
  const byKind = new Map<string, SyncRecord[]>();
  for (const r of records) {
    if (!accept(r)) continue;
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  let next: MicroWinsState = state;
  let changed = false;

  for (const kind of SYNC_KINDS) {
    const incoming = byKind.get(kind);
    if (!incoming) continue;
    const items = [...(next[kind] as readonly unknown[])];
    const index = new Map(items.map((r, i) => [recordKey(kind, r as never), i]));
    const removed = new Set<string>();
    let touched = false;

    for (const r of incoming) {
      const at = index.get(r.key);
      if (r.data === null || r.data === undefined) {
        if (at !== undefined && !removed.has(r.key)) {
          removed.add(r.key);
          touched = true;
        }
        continue;
      }
      if (at === undefined) {
        index.set(r.key, items.length);
        items.push(r.data);
        removed.delete(r.key);
        touched = true;
      } else if (!same(items[at], r.data)) {
        items[at] = r.data;
        removed.delete(r.key);
        touched = true;
      }
    }

    if (!touched) continue;
    changed = true;
    const kept = items.filter((r) => !removed.has(recordKey(kind, r as never)));
    next = { ...next, [kind]: kept };
  }

  const order = (byKind.get(NODE_ORDER_KIND) ?? []).find((r) => r.key === NODE_ORDER_KEY);
  if (order && Array.isArray(order.data)) {
    const sorted = orderNodes(next.nodes, order.data as unknown[]);
    if (!sameOrder(sorted, next.nodes)) {
      next = { ...next, nodes: sorted };
      changed = true;
    }
  }

  if (!changed) return state;
  // Z cizího zařízení může přijít starší tvar dat - srovná se stejně jako
  // při načtení z localStorage.
  return parseState(JSON.stringify(next)) ?? next;
}

/** Uzly v pořadí podle seznamu id; ty, které v seznamu nejsou, zůstanou na konci. */
function orderNodes(nodes: TreeNode[], ids: unknown[]): TreeNode[] {
  const rank = new Map(ids.filter((id): id is string => typeof id === "string").map((id, i) => [id, i]));
  const listed = nodes.filter((n) => rank.has(n.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...nodes.filter((n) => !rank.has(n.id))];
}

/** Stav účtu složený jen ze záznamů. */
export function fromRecords(records: readonly SyncRecord[]): MicroWinsState {
  return applyRecords(EMPTY_STATE, records);
}

/** Je ve stavu vůbec něco? Prázdné zařízení nemá co slučovat. */
export function isEmptyState(state: MicroWinsState): boolean {
  return SYNC_KINDS.every((kind) => state[kind].length === 0);
}
