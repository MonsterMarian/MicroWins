import { todayISO } from "./date";
import {
  aggregationOf,
  dayTotal,
  entriesOfMetric,
  evaluate,
  gt,
  isFlagKind,
  isMarkedOn,
  nodeById,
  onceEntry,
  recordOf,
  round4,
  subtreeIds,
  validateValue,
  type Evaluation,
} from "./domain";
import type { Aggregation, Entry, ISODate, MicroWinsState, Microwin, TreeNode } from "./types";
import { createId } from "./utils";

/**
 * Čisté přechody stavu. Žádný React, žádné localStorage - díky tomu je
 * celá logika microwinů testovatelná (viz actions.test.ts).
 */

// --- strom ------------------------------------------------------------------

export function addCategory(
  state: MicroWinsState,
  parentId: string | null,
  name: string,
  /** Nevyplněno = kreslená složka, stejně jako u dat z doby před ikonami. */
  icon?: string,
): { state: MicroWinsState; node: TreeNode } {
  const node: TreeNode = {
    id: createId("cat"),
    parentId,
    kind: "category",
    name: name.trim(),
    icon: icon?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  return { state: { ...state, nodes: [...state.nodes, node] }, node };
}

export interface MetricInput {
  name: string;
  unit?: string;
  aggregation?: Aggregation;
}

export function addMetric(
  state: MicroWinsState,
  parentId: string | null,
  input: MetricInput,
): { state: MicroWinsState; node: TreeNode } {
  const node: TreeNode = {
    id: createId("met"),
    parentId,
    kind: "metric",
    name: input.name.trim(),
    unit: input.unit?.trim() || undefined,
    aggregation: input.aggregation ?? "sum",
    createdAt: new Date().toISOString(),
  };
  return { state: { ...state, nodes: [...state.nodes, node] }, node };
}

/**
 * Zaškrtávací win: žádné číslo, žádný rekord. Text je prostý ("Ranní protažení"),
 * hodnotu nese jen fakt, že den je odškrtnutý.
 */
export function addCheck(
  state: MicroWinsState,
  parentId: string | null,
  name: string,
): { state: MicroWinsState; node: TreeNode } {
  const node: TreeNode = {
    id: createId("chk"),
    parentId,
    kind: "check",
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  return { state: { ...state, nodes: [...state.nodes, node] }, node };
}

export interface OnceInput {
  name: string;
  /** Den, kdy se to stalo. Výchozí = dnešek. */
  date?: ISODate;
  note?: string;
}

export interface AddOnceResult {
  state: MicroWinsState;
  node: TreeNode;
  microwin?: Microwin;
}

/**
 * Jednorázový win. Vytvořením je rovnou hotový - uzel, jeho jediný záznam
 * i microwin ke dni, kdy se to stalo, vznikají naráz.
 */
export function addOnce(
  state: MicroWinsState,
  parentId: string | null,
  input: OnceInput,
  today: ISODate = todayISO(),
): AddOnceResult {
  const raw = input.date ?? today;
  const date = raw > today ? today : raw;

  const node: TreeNode = {
    id: createId("one"),
    parentId,
    kind: "once",
    name: input.name.trim(),
    createdAt: new Date().toISOString(),
  };
  const entry: Entry = {
    id: createId("ent"),
    metricId: node.id,
    date,
    value: 1,
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    backdated: date !== today,
  };

  const withNode: MicroWinsState = {
    ...state,
    nodes: [...state.nodes, node],
    entries: [...state.entries, entry],
  };
  const sync = syncFlagMicrowin(withNode, node.id, date);
  return { state: sync.state, node, microwin: sync.microwin };
}

export function updateNode(
  state: MicroWinsState,
  id: string,
  patch: Partial<Pick<TreeNode, "name" | "icon" | "unit" | "aggregation">>,
  today: ISODate = todayISO(),
): MicroWinsState {
  const next: MicroWinsState = {
    ...state,
    nodes: state.nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() : n.name,
            // Prázdná ikona neznamená "nech starou", ale "vrať kreslenou složku".
            icon: patch.icon !== undefined ? patch.icon.trim() || undefined : n.icon,
            unit: patch.unit !== undefined ? patch.unit.trim() || undefined : n.unit,
          }
        : n,
    ),
  };
  const node = nodeById(next.nodes, id);
  if (node?.kind === "metric") return syncTodayMicrowin(next, id, today).state;
  return next;
}

/**
 * Přesune uzel (s celým podstromem) pod jinou složku; `null` = na kořen.
 *
 * Podstrom se nikam nekopíruje - stačí přepsat rodiče, děti visí na `parentId`.
 * Do vlastního potomka to logicky nejde, tím by se strom zacyklil a uzel
 * i s obsahem by zmizel z dosahu.
 */
export function moveNode(
  state: MicroWinsState,
  id: string,
  targetId: string | null,
): MicroWinsState {
  const node = nodeById(state.nodes, id);
  if (!node || node.parentId === targetId) return state;

  if (targetId !== null) {
    const target = nodeById(state.nodes, targetId);
    // Cílem může být jen složka - winy jsou listy stromu.
    if (!target || target.kind !== "category") return state;
    if (subtreeIds(state.nodes, id).includes(targetId)) return state;
  }

  return {
    ...state,
    nodes: state.nodes.map((n) => (n.id === id ? { ...n, parentId: targetId } : n)),
  };
}

/** Složky, do kterých se uzel smí přesunout (bez sebe a svých potomků). */
export function moveTargets(state: MicroWinsState, id: string): TreeNode[] {
  const blocked = new Set(subtreeIds(state.nodes, id));
  return state.nodes.filter((n) => n.kind === "category" && !blocked.has(n.id));
}

/** Smaže uzel včetně celého podstromu, jeho záznamů i microwinů. */
export function deleteNode(state: MicroWinsState, id: string): MicroWinsState {
  const ids = new Set(subtreeIds(state.nodes, id));
  return {
    ...state,
    nodes: state.nodes.filter((n) => !ids.has(n.id)),
    entries: state.entries.filter((e) => !ids.has(e.metricId)),
    microwins: state.microwins.filter((m) => !ids.has(m.metricId)),
  };
}

// --- microwin synchronizace -------------------------------------------------

export interface SyncResult {
  state: MicroWinsState;
  microwin?: Microwin;
  created: boolean;
  improved: boolean;
  revoked: boolean;
}

/**
 * Přepočítá microwin metriky pro DNEŠNÍ den.
 *
 * Minulé microwiny se nikdy nepřepisují - jsou to získané fakty. Dnešek se ale
 * drží konzistentní: když zpětný zápis posune rekord nad dnešní součet nebo se
 * dnešní záznam smaže, dnešní microwin se odebere.
 */
export function syncTodayMicrowin(
  state: MicroWinsState,
  metricId: string,
  today: ISODate = todayISO(),
): SyncResult {
  const metric = nodeById(state.nodes, metricId);
  if (!metric || metric.kind !== "metric") {
    return { state, created: false, improved: false, revoked: false };
  }

  const aggregation = aggregationOf(metric);
  const entries = entriesOfMetric(state.entries, metricId);
  const total = dayTotal(entries, today, aggregation);
  const previous = recordOf(entries, aggregation, today);
  const existing = state.microwins.find((m) => m.metricId === metricId && m.date === today);
  const isWin = gt(total, previous.value);

  if (!isWin) {
    if (!existing) return { state, created: false, improved: false, revoked: false };
    return {
      state: { ...state, microwins: state.microwins.filter((m) => m !== existing) },
      created: false,
      improved: false,
      revoked: true,
    };
  }

  if (existing) {
    const updated: Microwin = {
      ...existing,
      value: round4(total),
      previousRecord: previous.value,
    };
    return {
      state: { ...state, microwins: state.microwins.map((m) => (m === existing ? updated : m)) },
      microwin: updated,
      created: false,
      improved: gt(total, existing.value),
      revoked: false,
    };
  }

  const microwin: Microwin = {
    id: createId("win"),
    metricId,
    date: today,
    value: round4(total),
    previousRecord: previous.value,
    firstEver: entries.every((e) => e.date === today),
    createdAt: new Date().toISOString(),
  };
  return {
    state: { ...state, microwins: [...state.microwins, microwin] },
    microwin,
    created: true,
    improved: false,
    revoked: false,
  };
}

/**
 * Microwin uzlů bez čísla (check, once) pro jeden konkrétní den.
 *
 * Pravidlo je prosté: záznam toho dne existuje = microwin toho dne existuje.
 * Na rozdíl od metriky se tu nehoní rekord, takže i zpětné zaškrtnutí win dává -
 * je to pravda o tom dni, ne dohnaný výkon. Odškrtnutí ho zase odebere.
 */
export function syncFlagMicrowin(
  state: MicroWinsState,
  nodeId: string,
  date: ISODate,
): SyncResult {
  const node = nodeById(state.nodes, nodeId);
  if (!node || !isFlagKind(node.kind)) {
    return { state, created: false, improved: false, revoked: false };
  }

  const marked = isMarkedOn(state.entries, nodeId, date);
  const existing = state.microwins.find((m) => m.metricId === nodeId && m.date === date);

  if (!marked) {
    if (!existing) return { state, created: false, improved: false, revoked: false };
    return {
      state: { ...state, microwins: state.microwins.filter((m) => m !== existing) },
      created: false,
      improved: false,
      revoked: true,
    };
  }

  if (existing) {
    return { state, microwin: existing, created: false, improved: false, revoked: false };
  }

  const microwin: Microwin = {
    id: createId("win"),
    metricId: nodeId,
    date,
    value: 1,
    previousRecord: 0,
    firstEver: !state.entries.some((e) => e.metricId === nodeId && e.date < date),
    createdAt: new Date().toISOString(),
  };
  return {
    state: { ...state, microwins: [...state.microwins, microwin] },
    microwin,
    created: true,
    improved: false,
    revoked: false,
  };
}

export interface ToggleCheckResult {
  state: MicroWinsState;
  /** Stav po přepnutí: true = den je odškrtnutý. */
  checked: boolean;
  microwin?: Microwin;
}

/** Přepne zaškrtnutí checku pro daný den (výchozí dnešek). */
export function toggleCheck(
  state: MicroWinsState,
  nodeId: string,
  date?: ISODate,
  today: ISODate = todayISO(),
): ToggleCheckResult {
  const day = date ?? today;
  const node = nodeById(state.nodes, nodeId);
  if (!node || node.kind !== "check" || day > today) {
    return { state, checked: isMarkedOn(state.entries, nodeId, day) };
  }

  const wasChecked = isMarkedOn(state.entries, nodeId, day);
  const next: MicroWinsState = wasChecked
    ? {
        ...state,
        entries: state.entries.filter((e) => !(e.metricId === nodeId && e.date === day)),
      }
    : {
        ...state,
        entries: [
          ...state.entries,
          {
            id: createId("ent"),
            metricId: nodeId,
            date: day,
            value: 1,
            createdAt: new Date().toISOString(),
            backdated: day !== today,
          },
        ],
      };

  const sync = syncFlagMicrowin(next, nodeId, day);
  return { state: sync.state, checked: !wasChecked, microwin: sync.microwin };
}

export interface OncePatch {
  name?: string;
  date?: ISODate;
  note?: string;
}

/** Úprava jednorázového winu - text, den i poznámka sedí na jednom záznamu. */
export function updateOnce(
  state: MicroWinsState,
  nodeId: string,
  patch: OncePatch,
  today: ISODate = todayISO(),
): MicroWinsState {
  const node = nodeById(state.nodes, nodeId);
  if (!node || node.kind !== "once") return state;

  const entry = onceEntry(state.entries, nodeId);
  const oldDate = entry?.date ?? null;
  const rawDate = patch.date ?? oldDate ?? today;
  const date = rawDate > today ? today : rawDate;

  let next: MicroWinsState = {
    ...state,
    nodes: state.nodes.map((n) =>
      n.id === nodeId && patch.name !== undefined ? { ...n, name: patch.name.trim() } : n,
    ),
  };

  if (entry) {
    next = {
      ...next,
      entries: next.entries.map((e) =>
        e.id === entry.id
          ? {
              ...e,
              date,
              note: patch.note !== undefined ? patch.note.trim() || undefined : e.note,
              backdated: date !== today,
            }
          : e,
      ),
    };
  } else {
    next = {
      ...next,
      entries: [
        ...next.entries,
        {
          id: createId("ent"),
          metricId: nodeId,
          date,
          value: 1,
          note: patch.note?.trim() || undefined,
          createdAt: new Date().toISOString(),
          backdated: date !== today,
        },
      ],
    };
  }

  if (oldDate && oldDate !== date) next = syncFlagMicrowin(next, nodeId, oldDate).state;
  return syncFlagMicrowin(next, nodeId, date).state;
}

// --- záznamy ----------------------------------------------------------------

export interface AddEntryInput {
  metricId: string;
  value: number;
  /** Výchozí = dnešek. Starší datum = zpětný zápis (bez microwinu). */
  date?: ISODate;
  note?: string;
}

export interface AddEntryResult {
  state: MicroWinsState;
  evaluation: Evaluation;
  entry?: Entry;
  microwin?: Microwin;
  /** Microwin dneška se zlepšil (už existoval a hodnota vzrostla). */
  improved: boolean;
  /** Zpětný zápis posunul rekord nad dnešek -> dnešní microwin padl. */
  revoked: boolean;
}

export function addEntry(
  state: MicroWinsState,
  input: AddEntryInput,
  today: ISODate = todayISO(),
): AddEntryResult {
  const date = input.date ?? today;
  const metric = nodeById(state.nodes, input.metricId);

  const fail = (message: string): AddEntryResult => ({
    state,
    evaluation: {
      status: "invalid",
      message,
      dayTotal: 0,
      previousRecord: 0,
      previousRecordDate: null,
      beatsRecord: false,
      isMicrowin: false,
      isFirstEver: false,
      countsForToday: date === today,
    },
    improved: false,
    revoked: false,
  });

  if (!metric || metric.kind !== "metric") return fail("Metrika neexistuje.");
  if (date > today) return fail("Budoucí datum nejde zapsat.");

  const validation = validateValue(input.value);
  if (validation.status !== "ok") {
    const entries = entriesOfMetric(state.entries, input.metricId);
    return {
      state,
      evaluation: evaluate({
        entries,
        date,
        value: input.value,
        aggregation: aggregationOf(metric),
        today,
      }),
      improved: false,
      revoked: false,
    };
  }

  const entry: Entry = {
    id: createId("ent"),
    metricId: input.metricId,
    date,
    value: round4(input.value),
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    backdated: date !== today,
  };

  const withEntry: MicroWinsState = { ...state, entries: [...state.entries, entry] };
  const evaluation = evaluate({
    entries: entriesOfMetric(withEntry.entries, input.metricId),
    date,
    value: entry.value,
    aggregation: aggregationOf(metric),
    today,
  });

  const sync = syncTodayMicrowin(withEntry, input.metricId, today);

  return {
    state: sync.state,
    evaluation,
    entry,
    microwin: evaluation.isMicrowin ? sync.microwin : undefined,
    improved: evaluation.isMicrowin && sync.improved,
    revoked: sync.revoked,
  };
}

export function deleteEntry(
  state: MicroWinsState,
  entryId: string,
  today: ISODate = todayISO(),
): MicroWinsState {
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry) return state;
  const node = nodeById(state.nodes, entry.metricId);
  const next: MicroWinsState = {
    ...state,
    entries: state.entries.filter((e) => e.id !== entryId),
  };
  // Check a once visí na svém dni, metrika vždy na dnešku.
  if (node && isFlagKind(node.kind)) return syncFlagMicrowin(next, entry.metricId, entry.date).state;
  return syncTodayMicrowin(next, entry.metricId, today).state;
}
