import { addDays } from "./date";
import type { Aggregation, Entry, ISODate, MicroWinsState, NodeKind, TreeNode } from "./types";
import { formatNumber } from "./utils";

/**
 * Pravidla MicroWins (jádro aplikace, čisté funkce bez stavu).
 *
 * Metrika (číselný win):
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
 *
 * Check (opakovaný win bez čísla) a once (jednorázový win):
 * 7. Nemají rekord ani agregaci - jde jen o "stalo se / nestalo se".
 *    Záznam dne existuje = microwin toho dne, jeden na den a uzel.
 * 8. Proto tu neplatí pravidlo 5: zaškrtnutí zapomenutého dne je pravda o tom
 *    dni, ne dohánění rekordu. Odškrtnutí microwin zase odebere.
 * 9. Once má nejvýš jeden záznam - jeho datum je datum winu.
 */

export const EPS = 1e-9;

export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function gt(a: number, b: number): boolean {
  return a > b + EPS;
}

// --- strom ------------------------------------------------------------------

/**
 * Výchozí pořadí uvnitř složky: podsložky, pak číselné metriky, pak opakované
 * checky a úplně dole jednorázové winy.
 *
 * Platí ale jen jednou - při migraci starých dat (viz `lib/storage.ts`), kde
 * se z něj vyrobí pořadí v poli. Od té chvíle si pořadí drží uživatel
 * přetažením a tenhle žebříček už do něj nemluví.
 */
export const KIND_ORDER: Record<NodeKind, number> = {
  category: 0,
  metric: 1,
  check: 2,
  once: 3,
};

/**
 * Obsah složky v tom pořadí, v jakém uzly leží v poli.
 *
 * Žádné dotřiďování podle druhu ani data vzniku: přetažení ve stromu přepisuje
 * právě pořadí v poli (`reorderNodes`), takže jakékoli řazení tady by ho při
 * dalším vykreslení přebilo - složka by se po puštění vrátila zpátky.
 * Nový uzel se přidává na konec pole, tedy na konec své složky.
 */
export function childrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/**
 * Archivovaný uzel: buď je odložený sám, nebo je pod odloženou složkou.
 *
 * Dědičnost se počítá po rodičích, ne razítkem na potomcích - jinak by se po
 * vrácení složky z archivu nedalo poznat, co v ní bylo odložené zvlášť
 * a mělo tam zůstat.
 */
export function isArchived(nodes: TreeNode[], id: string): boolean {
  return pathOf(nodes, id).some((n) => Boolean(n.archivedAt));
}

/** Uzly, které se ve stromu nemají ukazovat (odložené i jejich podstromy). */
export function archivedIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.archivedAt) for (const id of subtreeIds(nodes, node.id)) ids.add(id);
  }
  return ids;
}

/**
 * Obsah složky bez archivovaných uzlů - to, co se kreslí ve stromu.
 *
 * Filtruje se jen podle razítka na samotném uzlu: do archivované složky se
 * stejně nedá vejít, takže její obsah nemá kde vykouknout.
 */
export function liveChildrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return childrenOf(nodes, parentId).filter((n) => !n.archivedAt);
}

/** Win = list stromu, tedy všechno kromě kategorie. */
export function isWinNode(node: TreeNode | undefined): boolean {
  return node !== undefined && node.kind !== "category";
}

/** Check a once sdílí pravidlo "záznam dne = microwin dne". */
export function isFlagKind(kind: NodeKind): boolean {
  return kind === "check" || kind === "once";
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

export function winNodesOf(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter((n) => n.kind !== "category");
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

// --- check a once -----------------------------------------------------------

/** Dny, ke kterým uzel má záznam (u checku = zaškrtnuté dny). */
export function markedDates(entries: Entry[], nodeId: string): Set<ISODate> {
  return new Set(entries.filter((e) => e.metricId === nodeId).map((e) => e.date));
}

export function isMarkedOn(entries: Entry[], nodeId: string, date: ISODate): boolean {
  return entries.some((e) => e.metricId === nodeId && e.date === date);
}

/** Once má nejvýš jeden záznam - ten nese datum a poznámku winu. */
export function onceEntry(entries: Entry[], nodeId: string): Entry | undefined {
  return entriesOfMetric(entries, nodeId)[0];
}

export interface FlagSummary {
  node: TreeNode;
  path: string;
  doneToday: boolean;
  /** Kolik dnů je odškrtnutých (u once 0 nebo 1). */
  dayCount: number;
  firstDate: ISODate | null;
  lastDate: ISODate | null;
  /** Aktuální série dnů zpětně od dneška (u once se nepoužívá). */
  streak: number;
}

export function summarizeFlag(
  state: MicroWinsState,
  node: TreeNode,
  today: ISODate,
): FlagSummary {
  const dates = [...markedDates(state.entries, node.id)].sort();
  const set = new Set(dates);

  // série: od dneška (nebo včerejška, pokud dnešek chybí) zpět po dnech
  let streak = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  return {
    node,
    path: breadcrumb(state.nodes, node.id),
    doneToday: set.has(today),
    dayCount: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    streak,
  };
}

/** Součet microwinů v podstromu (kategorie i metriky). */
export function microwinsInSubtree(state: MicroWinsState, nodeId: string): number {
  const ids = new Set(subtreeIds(state.nodes, nodeId));
  return state.microwins.filter((m) => ids.has(m.metricId)).length;
}
