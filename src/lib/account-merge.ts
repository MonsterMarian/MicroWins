import type { StateKey } from "./parts";
import { BRAIN_DUMP_MAX } from "./timebox";
import type { DaySheet, Microwin, MicroWinsState, Priority } from "./types";

/**
 * Převzetí dat ze zařízení do uživatelského účtu.
 *
 * Připravené pro přihlašování (návrh v `DATABAZE.md`), zatím nikde nevolané.
 * Řeší přesně ten okamžik, kdy si člověk, který appku dosud používal bez účtu,
 * účet založí - nebo se na dalším zařízení přihlásí do účtu, který už má.
 * Data z telefonu se v tu chvíli **nesmějí ztratit ani zdvojit**.
 *
 * Proč ne `mergeState(…, "add")` z importu: ten id přerazí, aby se cizí záloha
 * nepotkala s tím, co v appce je. Tady je to naopak - id je jediné, podle čeho
 * se pozná, že projekt na tabletu a projekt v účtu je tentýž (tablet ho dostal
 * obnovou ze zálohy z telefonu). Přeražená id by ho zdvojila a synchronizace
 * by potom každou kopii vedla zvlášť.
 *
 * Pravidla:
 *
 * - Co je jen na zařízení, přibude do účtu. Id zůstávají.
 * - Co je na obou stejné, zůstane jednou.
 * - Co je na obou pod stejným id, ale jinak, je **konflikt**. Vyhraje novější
 *   změna, pokud ji `stamps` znají; jinak účet - to je verze, kterou už vidí
 *   ostatní zařízení, a přepsat ji něčím neznámého stáří by rozjelo i je.
 *   Prohraná verze se nezahazuje potichu: je v seznamu `conflicts` a v záloze,
 *   kterou appka udělá před sloučením (viz DATABAZE.md).
 * - Listy time boxu drží den, ne id, a psal je člověk rukou - ty se slévají:
 *   prázdná priorita se doplní, brain dump se spojí.
 * - Microwin je nejvýš jeden na win a den; dva ze dvou zařízení se slijí do
 *   toho vyššího.
 *
 * Čistá funkce bez localStorage a sítě - viz `account-merge.test.ts`.
 */

/** Kdy se záznam naposledy změnil (ISO), podle klíče `druh:id` - viz `stampKey`. */
export interface MergeStamps {
  account?: ReadonlyMap<string, string>;
  local?: ReadonlyMap<string, string>;
}

export interface AccountConflict {
  kind: StateKey;
  /** Id záznamu, u listu time boxu datum. */
  key: string;
  kept: "account" | "local";
}

export interface AccountMerge {
  state: MicroWinsState;
  /** Kolik záznamů ze zařízení do účtu přibylo, po kolekcích. */
  added: Partial<Record<StateKey, number>>;
  conflicts: AccountConflict[];
}

type Keyed = { [K in StateKey]: MicroWinsState[K][number] };

/**
 * Čím se záznam pozná napříč zařízeními. Většina má id; otisky postupu
 * a listy time boxu id nemají a drží je projekt, úkol nebo den.
 */
export function recordKey<K extends StateKey>(kind: K, record: Keyed[K]): string {
  const r = record as unknown as Record<string, string>;
  if (kind === "snapshots") return `${r.projectId}|${r.date}`;
  if (kind === "taskSnapshots") return `${r.taskId}|${r.date}`;
  if (kind === "daySheets") return r.date;
  return r.id;
}

export function stampKey(kind: StateKey, key: string): string {
  return `${kind}:${key}`;
}

/** Spočítané údaje - konflikt v nich nikoho nezajímá, jen se vyřeší. */
const DERIVED: ReadonlySet<StateKey> = new Set(["snapshots", "taskSnapshots", "microwins"]);

/** Kolekce slučované podle klíče; listy time boxu mají vlastní pravidlo. */
const KEYED: readonly Exclude<StateKey, "daySheets">[] = [
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
];

/**
 * Pole, která se při porovnání nepočítají. Pořadí projektů a ToDo se při
 * převzetí posouvá za účet (`appendOrder`), takže by se jinak stejný projekt
 * při druhém převzetí tvářil jako konflikt. Pořadí se prostě bere z účtu.
 */
const IGNORED: Partial<Record<StateKey, readonly string[]>> = {
  projects: ["order"],
  todos: ["order"],
};

/** Porovnání záznamů bez ohledu na pořadí klíčů v objektu. Sdílí ho i `sync.ts`. */
export function same(a: unknown, b: unknown, ignore: readonly string[] = []): boolean {
  return stable(a, ignore) === stable(b, ignore);
}

function stable(value: unknown, ignore: readonly string[] = []): string {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined && !ignore.includes(k))
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function mergeIntoAccount(
  account: MicroWinsState,
  local: MicroWinsState,
  stamps: MergeStamps = {},
): AccountMerge {
  const conflicts: AccountConflict[] = [];
  const added: Partial<Record<StateKey, number>> = {};
  const next: MicroWinsState = { ...account };

  for (const kind of KEYED) {
    const merged = mergeKeyed(
      kind,
      account[kind] as Keyed[typeof kind][],
      local[kind] as Keyed[typeof kind][],
      stamps,
      conflicts,
    );
    if (merged.added > 0) added[kind] = merged.added;
    (next as unknown as Record<StateKey, unknown>)[kind] = merged.items;
  }

  const sheets = mergeSheets(account.daySheets, local.daySheets, conflicts);
  if (sheets.added > 0) added.daySheets = sheets.added;
  next.daySheets = sheets.items;

  next.microwins = dedupeMicrowins(next.microwins);
  next.projects = appendOrder(account.projects, next.projects);
  next.todos = appendOrder(account.todos, next.todos);

  return { state: next, added, conflicts };
}

function mergeKeyed<K extends StateKey>(
  kind: K,
  account: Keyed[K][],
  local: Keyed[K][],
  stamps: MergeStamps,
  conflicts: AccountConflict[],
): { items: Keyed[K][]; added: number } {
  const index = new Map(account.map((r, i) => [recordKey(kind, r), i]));
  const items = [...account];
  let added = 0;

  for (const record of local) {
    const key = recordKey(kind, record);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, items.length);
      items.push(record);
      added += 1;
      continue;
    }
    if (same(items[at], record, IGNORED[kind])) continue;

    const localAt = stamps.local?.get(stampKey(kind, key));
    const accountAt = stamps.account?.get(stampKey(kind, key));
    const localWins = localAt !== undefined && (accountAt === undefined || localAt > accountAt);
    if (localWins) items[at] = record;
    if (!DERIVED.has(kind)) conflicts.push({ kind, key, kept: localWins ? "local" : "account" });
  }

  return { items, added };
}

/**
 * Listy time boxu ze dvou zařízení k témuž dni. Nic z nich se nezahodí:
 * prázdná priorita v účtu se doplní z telefonu, obsazená zůstane a ta
 * z telefonu se připíše do brain dumpu, stejně jako jeho vlastní text.
 * Kdyby spojený brain dump přetekl limit, zůstane list z účtu a den se
 * nahlásí jako konflikt - oříznout ho by znamenalo tiše ztratit konec.
 */
function mergeSheets(
  account: DaySheet[],
  local: DaySheet[],
  conflicts: AccountConflict[],
): { items: DaySheet[]; added: number } {
  const byDate = new Map(account.map((s) => [s.date, s]));
  let added = 0;

  for (const sheet of local) {
    const current = byDate.get(sheet.date);
    if (!current) {
      byDate.set(sheet.date, sheet);
      added += 1;
      continue;
    }
    if (same(current, sheet)) continue;

    const extra: string[] = [];
    const priorities: Priority[] = current.priorities.map((mine, i) => {
      const theirs = sheet.priorities[i];
      if (!theirs || theirs.text.trim() === "") return mine;
      if (mine.text.trim() === "") return theirs;
      if (mine.text.trim() === theirs.text.trim()) return { ...mine, done: mine.done || theirs.done };
      extra.push(`• ${theirs.text.trim()}`);
      return mine;
    });
    if (sheet.brainDump.trim() !== "") extra.unshift(sheet.brainDump.trim());

    const additions = extra.filter((part) => !current.brainDump.includes(part));
    const brainDump = [current.brainDump.trim(), ...additions].filter(Boolean).join("\n\n");

    if (brainDump.length > BRAIN_DUMP_MAX) {
      conflicts.push({ kind: "daySheets", key: sheet.date, kept: "account" });
      continue;
    }
    byDate.set(sheet.date, {
      ...current,
      priorities,
      brainDump: additions.length > 0 ? brainDump : current.brainDump,
    });
  }

  return { items: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), added };
}

/** Jeden microwin na win a den - ze dvou zařízení zůstane ten vyšší. */
function dedupeMicrowins(microwins: Microwin[]): Microwin[] {
  const best = new Map<string, Microwin>();
  for (const w of microwins) {
    const key = `${w.metricId}|${w.date}`;
    const kept = best.get(key);
    if (!kept || w.value > kept.value) best.set(key, w);
  }
  const keep = new Set(best.values());
  return microwins.filter((w) => keep.has(w));
}

/**
 * Projekty a ToDo, které přibyly ze zařízení, se řadí **za** ty z účtu.
 * Obě strany čísluje od nuly, takže bez posunu by se dva seznamy prolnuly
 * a ruční pořadí z účtu by se rozsypalo.
 */
function appendOrder<T extends { id: string; order: number; createdAt: string }>(
  account: T[],
  merged: T[],
): T[] {
  const own = new Set(account.map((r) => r.id));
  const base = account.reduce((max, r) => Math.max(max, r.order + 1), 0);
  const rank = new Map(
    merged
      .filter((r) => !own.has(r.id))
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
      .map((r, i) => [r.id, i]),
  );
  return merged.map((r) => {
    const i = rank.get(r.id);
    return i === undefined ? r : { ...r, order: base + i };
  });
}
