import { todayISO } from "./date";
import {
  aggregationOf,
  dayTotal,
  entriesOfMetric,
  evaluate,
  gt,
  nodeById,
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
): { state: MicroWinsState; node: TreeNode } {
  const node: TreeNode = {
    id: createId("cat"),
    parentId,
    kind: "category",
    name: name.trim(),
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

export function updateNode(
  state: MicroWinsState,
  id: string,
  patch: Partial<Pick<TreeNode, "name" | "unit" | "aggregation">>,
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
            unit: patch.unit !== undefined ? patch.unit.trim() || undefined : n.unit,
          }
        : n,
    ),
  };
  const node = nodeById(next.nodes, id);
  if (node?.kind === "metric") return syncTodayMicrowin(next, id, today).state;
  return next;
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
  const next: MicroWinsState = {
    ...state,
    entries: state.entries.filter((e) => e.id !== entryId),
  };
  return syncTodayMicrowin(next, entry.metricId, today).state;
}
