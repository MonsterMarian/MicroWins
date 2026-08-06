import type { Aggregation, Entry, ISODate, MicroWinsState, TreeNode } from "./types";
import { formatNumber } from "./utils";

/**
 * Pravidla MicroWins (jádro aplikace, čisté funkce bez stavu):
 *
 * 1. Hodnota záznamu je vždy číslo > 0, může být desetinné (2.5 H).
 *    0 se ignoruje (není to chyba, jen se nic nestane), záporné číslo je chyba.
 * 2. Denní součet metriky = agregace všech záznamů daného dne (sum / max).
 * 3. Rekord metriky = nejvyšší denní součet napříč všemi dny.
 * 4. Microwin = záznam k DNEŠNÍMU dni, po kterém dnešní součet překoná
 *    dosavadní rekord (počítaný ze všech ostatních dnů).
 *    První záznam metriky vůbec je tedy vždy microwin (rekord byl 0).
 * 5. Zpětně zadaný záznam (starší datum) microwin NIKDY nedává - může ale
 *    posunout rekord, protože rekord je vlastnost dne, ne okamžiku zápisu.
 * 6. Za jednu metriku je za den maximálně jeden microwin. Když se výkon
 *    během dne ještě zlepší, microwin se aktualizuje (nezdvojuje se).
 */

export const EPS = 1e-9;

export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function gt(a: number, b: number): boolean {
  return a > b + EPS;
}

// --- strom ------------------------------------------------------------------

export function childrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => {
      // kategorie nahoře, pak podle vytvoření
      if (a.kind !== b.kind) return a.kind === "category" ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export function nodeById(nodes: TreeNode[], id: string): TreeNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** Cesta od kořene k uzlu (včetně uzlu samotného). */
export function pathOf(nodes: TreeNode[], id: string): TreeNode[] {
  const path: TreeNode[] = [];
  let current = nodeById(nodes, id);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    current = current.parentId ? nodeById(nodes, current.parentId) : undefined;
  }
  return path;
}

/** "Business / cold calls" - cesta bez samotné metriky. */
export function breadcrumb(nodes: TreeNode[], id: string): string {
  return pathOf(nodes, id)
    .slice(0, -1)
    .map((n) => n.name)
    .join(" / ");
}

/** Uzel + všichni potomci (pro kaskádní mazání). */
export function subtreeIds(nodes: TreeNode[], rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    for (const child of nodes.filter((n) => n.parentId === ids[i])) {
      ids.push(child.id);
    }
  }
  return ids;
}

export function metricsOf(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.kind === "metric");
}

// --- popisky ----------------------------------------------------------------

/**
 * Nahradí zástupné "X" (nebo "x") v šabloně hodnotou.
 * "X cold calls za den" + 4 -> "4 cold calls za den"
 * Pokud šablona žádné samostatné X nemá, hodnota se předsadí dopředu.
 */
export function formatMetricLabel(template: string, value: number, unit?: string): string {
  const num = formatNumber(value);
  const withUnit = unit ? `${num} ${unit}` : num;
  if (/(^|[^\p{L}\p{N}])X([^\p{L}\p{N}]|$)/u.test(template)) {
    return template.replace(/(^|[^\p{L}\p{N}])X(?=[^\p{L}\p{N}]|$)/u, `$1${withUnit}`);
  }
  if (/(^|[^\p{L}\p{N}])x([^\p{L}\p{N}]|$)/u.test(template)) {
    return template.replace(/(^|[^\p{L}\p{N}])x(?=[^\p{L}\p{N}]|$)/u, `$1${withUnit}`);
  }
  return `${withUnit} ${template}`.trim();
}

export function hasPlaceholder(template: string): boolean {
  return /(^|[^\p{L}\p{N}])[Xx]([^\p{L}\p{N}]|$)/u.test(template);
}

// --- záznamy a rekordy ------------------------------------------------------

export function entriesOfMetric(entries: Entry[], metricId: string): Entry[] {
  return entries
    .filter((e) => e.metricId === metricId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function aggregationOf(metric: TreeNode | undefined): Aggregation {
  return metric?.aggregation ?? "sum";
}

/** Denní součty metriky: den -> agregovaná hodnota. */
export function totalsByDay(entries: Entry[], aggregation: Aggregation = "sum"): Map<ISODate, number> {
  const map = new Map<ISODate, number>();
  for (const e of entries) {
    const prev = map.get(e.date);
    if (prev === undefined) map.set(e.date, round4(e.value));
    else map.set(e.date, aggregation === "max" ? Math.max(prev, e.value) : round4(prev + e.value));
  }
  return map;
}

export function dayTotal(
  entries: Entry[],
  date: ISODate,
  aggregation: Aggregation = "sum",
): number {
  return totalsByDay(
    entries.filter((e) => e.date === date),
    aggregation,
  ).get(date) ?? 0;
}

export interface RecordInfo {
  value: number;
  date: ISODate | null;
}

/** Nejlepší denní součet; volitelně s vynecháním jednoho dne. */
export function recordOf(
  entries: Entry[],
  aggregation: Aggregation = "sum",
  excludeDate?: ISODate,
): RecordInfo {
  let value = 0;
  let date: ISODate | null = null;
  for (const [day, total] of totalsByDay(entries, aggregation)) {
    if (excludeDate && day === excludeDate) continue;
    if (gt(total, value)) {
      value = total;
      date = day;
    }
  }
  return { value, date };
}

// --- vyhodnocení zápisu -----------------------------------------------------

export type AddStatus = "ok" | "ignored-zero" | "invalid";

export interface Evaluation {
  status: AddStatus;
  message?: string;
  /** Denní součet metriky po započtení nového záznamu. */
  dayTotal: number;
  /** Rekord ze všech ostatních dnů (0 = žádný). */
  previousRecord: number;
  previousRecordDate: ISODate | null;
  /** Den záznamu překonal dosavadní rekord. */
  beatsRecord: boolean;
  /** Rekord byl překonán A záznam patří k dnešku -> microwin. */
  isMicrowin: boolean;
  /** První den s daty u této metriky. */
  isFirstEver: boolean;
  /** Záznam patří k dnešku (jinak se k dnešku nepočítá). */
  countsForToday: boolean;
}

export interface EvaluateInput {
  /** Všechny záznamy metriky VČETNĚ nově přidávaného. */
  entries: Entry[];
  date: ISODate;
  value: number;
  aggregation?: Aggregation;
  today: ISODate;
}

export function validateValue(value: number): { status: AddStatus; message?: string } {
  if (!Number.isFinite(value)) return { status: "invalid", message: "Zadej číslo." };
  if (value < 0) return { status: "invalid", message: "Záznam nemůže být záporný." };
  if (value === 0) return { status: "ignored-zero", message: "Nula se nezapisuje." };
  return { status: "ok" };
}

export function evaluate({
  entries,
  date,
  value,
  aggregation = "sum",
  today,
}: EvaluateInput): Evaluation {
  const validation = validateValue(value);
  const total = dayTotal(entries, date, aggregation);
  const previous = recordOf(entries, aggregation, date);
  const otherDays = new Set(entries.filter((e) => e.date !== date).map((e) => e.date));
  const beatsRecord = validation.status === "ok" && gt(total, previous.value);
  const countsForToday = date === today;

  return {
    status: validation.status,
    message: validation.message,
    dayTotal: total,
    previousRecord: previous.value,
    previousRecordDate: previous.date,
    beatsRecord,
    isMicrowin: beatsRecord && countsForToday,
    isFirstEver: otherDays.size === 0,
    countsForToday,
  };
}

// --- odvozený pohled na metriku ---------------------------------------------

export interface MetricSummary {
  metric: TreeNode;
  path: string;
  aggregation: Aggregation;
  record: RecordInfo;
  todayTotal: number;
  /** Kolik chybí do rekordu (0 = rekord je právě teď překonaný). */
  toRecord: number;
  entryCount: number;
  lastEntryDate: ISODate | null;
  hasMicrowinToday: boolean;
  microwinCount: number;
}

export function summarizeMetric(
  state: MicroWinsState,
  metric: TreeNode,
  today: ISODate,
): MetricSummary {
  const aggregation = aggregationOf(metric);
  const entries = entriesOfMetric(state.entries, metric.id);
  const record = recordOf(entries, aggregation);
  const todayTotal = dayTotal(entries, today, aggregation);
  const microwins = state.microwins.filter((m) => m.metricId === metric.id);

  return {
    metric,
    path: breadcrumb(state.nodes, metric.id),
    aggregation,
    record,
    todayTotal,
    toRecord: gt(record.value, todayTotal) ? round4(record.value - todayTotal) : 0,
    entryCount: entries.length,
    lastEntryDate: entries[0]?.date ?? null,
    hasMicrowinToday: microwins.some((m) => m.date === today),
    microwinCount: microwins.length,
  };
}

/** Součet microwinů v podstromu (kategorie i metriky). */
export function microwinsInSubtree(state: MicroWinsState, nodeId: string): number {
  const ids = new Set(subtreeIds(state.nodes, nodeId));
  return state.microwins.filter((m) => ids.has(m.metricId)).length;
}
