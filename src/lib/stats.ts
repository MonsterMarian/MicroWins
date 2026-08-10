import { addDays, diffDays, todayISO, weekdayMondayFirst } from "./date";
import {
  breadcrumb,
  formatMetricLabel,
  markedDates,
  nodeById,
  onceEntry,
  pathOf,
  subtreeIds,
  summarizeFlag,
  summarizeMetric,
  winNodesOf,
} from "./domain";
import type { ISODate, MicroWinsState, Microwin, NodeKind, TreeNode } from "./types";
import { formatNumber } from "./utils";

export interface MicrowinItem {
  microwin: Microwin;
  /** Metrika: šablona s "X" nahrazeným hodnotou dne. Check a once: prostý text. */
  text: string;
  /** Druh winu, ze kterého microwin padl. */
  kind: NodeKind;
  /** "Business / cold calls" */
  path: string;
  value: number;
  previousRecord: number;
  firstEver: boolean;
}

/** Jednořádkové vysvětlení pod textem winu - u každého druhu jiné. */
export function winDetail(item: MicrowinItem): string {
  if (item.kind === "check") return "zaškrtnuto";
  if (item.kind === "once") return "jednorázový win";
  return item.firstEver
    ? "první zápis"
    : `předchozí rekord ${formatNumber(item.previousRecord)}`;
}

export interface DayRow {
  date: ISODate;
  count: number;
  items: MicrowinItem[];
}

/** Microwiny seskupené po dnech, nejnovější den první. */
export function dayRows(state: MicroWinsState): DayRow[] {
  const byDate = new Map<ISODate, MicrowinItem[]>();

  for (const m of state.microwins) {
    const metric = nodeById(state.nodes, m.metricId);
    if (!metric) continue; // uzel byl smazán
    const item: MicrowinItem = {
      microwin: m,
      text:
        metric.kind === "metric"
          ? formatMetricLabel(metric.name, m.value, metric.unit)
          : metric.name,
      kind: metric.kind,
      path: breadcrumb(state.nodes, metric.id),
      value: m.value,
      previousRecord: m.previousRecord,
      firstEver: m.firstEver,
    };
    const bucket = byDate.get(m.date);
    if (bucket) bucket.push(item);
    else byDate.set(m.date, [item]);
  }

  return [...byDate.entries()]
    .map(([date, items]) => ({
      date,
      count: items.length,
      items: items.sort((a, b) => a.microwin.createdAt.localeCompare(b.microwin.createdAt)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function microwinDates(state: MicroWinsState): Set<ISODate> {
  return new Set(state.microwins.map((m) => m.date));
}

export interface StreakInfo {
  current: number;
  longest: number;
  /** Dnes už microwin je - série je pro dnešek uzavřená. */
  todayDone: boolean;
  /** Série běží, ale dnešek zatím chybí (končí dnes o půlnoci). */
  atRisk: boolean;
  lastActiveDate: ISODate | null;
}

export function streaks(state: MicroWinsState, today: ISODate = todayISO()): StreakInfo {
  const dates = microwinDates(state);
  const sorted = [...dates].sort();
  const lastActiveDate = sorted.length ? sorted[sorted.length - 1] : null;

  // nejdelší série
  let longest = 0;
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of sorted) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    prev = d;
    if (run > longest) longest = run;
  }

  // aktuální série: počítáme zpět od dneška, případně od včerejška
  const todayDone = dates.has(today);
  let cursor = todayDone ? today : addDays(today, -1);
  const atRisk = !todayDone && dates.has(cursor);
  let current = 0;
  while (dates.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  return { current, longest, todayDone, atRisk, lastActiveDate };
}

export interface Totals {
  allTime: number;
  today: number;
  last7: number;
  last30: number;
  thisMonth: number;
  activeDays: number;
  bestDay: { date: ISODate; count: number } | null;
  /** Průměr microwinů na aktivní den. */
  avgPerActiveDay: number;
}

export function totals(state: MicroWinsState, today: ISODate = todayISO()): Totals {
  const rows = dayRows(state);
  const from7 = addDays(today, -6);
  const from30 = addDays(today, -29);
  const monthPrefix = today.slice(0, 7);

  const inRange = (date: ISODate, from: ISODate) => date >= from && date <= today;

  const best = rows.reduce<{ date: ISODate; count: number } | null>((acc, r) => {
    if (!acc || r.count > acc.count) return { date: r.date, count: r.count };
    return acc;
  }, null);

  const allTime = state.microwins.length;
  const activeDays = rows.length;

  return {
    allTime,
    today: rows.find((r) => r.date === today)?.count ?? 0,
    last7: rows.filter((r) => inRange(r.date, from7)).reduce((s, r) => s + r.count, 0),
    last30: rows.filter((r) => inRange(r.date, from30)).reduce((s, r) => s + r.count, 0),
    thisMonth: rows
      .filter((r) => r.date.startsWith(monthPrefix))
      .reduce((s, r) => s + r.count, 0),
    activeDays,
    bestDay: best,
    avgPerActiveDay: activeDays ? Math.round((allTime / activeDays) * 10) / 10 : 0,
  };
}

export interface HeatCell {
  date: ISODate;
  count: number;
  future: boolean;
  /** Den spadá do sousedního roku - drží mřížku, ale nekreslí se. */
  outside: boolean;
}

/**
 * Kalendář jednoho roku: leden až prosinec, sloupec = týden od pondělí.
 *
 * Rok je pevná jednotka, ne klouzavé okno - "posledních 53 týdnů" začínalo
 * uprostřed loňska a nešlo se podle toho zorientovat. Krajní týdny přetékají
 * do sousedních roků, ty dny se jen nekreslí.
 */
export function yearHeatmap(
  state: MicroWinsState,
  year: number,
  today: ISODate = todayISO(),
): HeatCell[][] {
  const counts = new Map<ISODate, number>();
  for (const r of dayRows(state)) counts.set(r.date, r.count);

  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const start = addDays(first, -weekdayMondayFirst(first));
  const weeks = Math.ceil((diffDays(start, last) + 1) / 7);

  const grid: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      column.push({
        date,
        count: counts.get(date) ?? 0,
        future: date > today,
        outside: date < first || date > last,
      });
    }
    grid.push(column);
  }
  return grid;
}

/** Roky, ve kterých něco padlo, plus letošek - nabídka přepínače kalendáře. */
export function activeYears(state: MicroWinsState, today: ISODate = todayISO()): number[] {
  const years = new Set(state.microwins.map((m) => Number(m.date.slice(0, 4))));
  years.add(Number(today.slice(0, 4)));
  return [...years].sort((a, b) => a - b);
}

// --- přehled winů -----------------------------------------------------------

interface WinBase {
  node: TreeNode;
  /** "Business / cold calls" */
  path: string;
  microwinCount: number;
  /** Dnes se u winu něco stalo (zápis, zaškrtnutí). */
  activeToday: boolean;
  /** Dnes padl microwin. */
  winToday: boolean;
  lastDate: ISODate | null;
}

/**
 * Jeden win pro přehled v Analýze. Rozlišené podle druhu, protože číselný win
 * má rekord, zaškrtávací sérii a jednorázový jen datum - společná tabulka
 * s prázdnými sloupci se nedala číst.
 */
export type WinOverview =
  | (WinBase & {
      kind: "metric";
      record: number;
      recordDate: ISODate | null;
      todayTotal: number;
      /** Kolik dnes chybí do rekordu (0 = rekord padl). */
      toRecord: number;
      /** Dnešek vůči rekordu, 0-100 %. */
      progress: number;
      entryCount: number;
      unit?: string;
    })
  | (WinBase & {
      kind: "check";
      dayCount: number;
      streak: number;
      doneToday: boolean;
      /** Posledních 7 dnů (nejstarší první) - zaškrtnuto / ne. */
      recentDays: boolean[];
    })
  | (WinBase & { kind: "once"; date: ISODate | null });

export function winOverview(state: MicroWinsState, today: ISODate = todayISO()): WinOverview[] {
  const out: WinOverview[] = [];

  for (const node of winNodesOf(state.nodes)) {
    const microwins = state.microwins.filter((m) => m.metricId === node.id);
    const base: WinBase = {
      node,
      path: breadcrumb(state.nodes, node.id),
      microwinCount: microwins.length,
      activeToday: false,
      winToday: microwins.some((m) => m.date === today),
      lastDate: null,
    };

    if (node.kind === "metric") {
      const s = summarizeMetric(state, node, today);
      out.push({
        ...base,
        kind: "metric",
        activeToday: s.todayTotal > 0,
        lastDate: s.lastEntryDate,
        record: s.record.value,
        recordDate: s.record.date,
        todayTotal: s.todayTotal,
        toRecord: s.toRecord,
        progress: s.record.value > 0 ? Math.min(100, (s.todayTotal / s.record.value) * 100) : 0,
        entryCount: s.entryCount,
        unit: node.unit,
      });
      continue;
    }

    if (node.kind === "check") {
      const s = summarizeFlag(state, node, today);
      const marked = markedDates(state.entries, node.id);
      out.push({
        ...base,
        kind: "check",
        activeToday: s.doneToday,
        lastDate: s.lastDate,
        dayCount: s.dayCount,
        streak: s.streak,
        doneToday: s.doneToday,
        recentDays: Array.from({ length: 7 }, (_, i) => marked.has(addDays(today, i - 6))),
      });
      continue;
    }

    const entry = onceEntry(state.entries, node.id);
    out.push({
      ...base,
      kind: "once",
      activeToday: entry?.date === today,
      lastDate: entry?.date ?? null,
      date: entry?.date ?? null,
    });
  }

  return out;
}

export interface CategoryStat {
  node: TreeNode;
  count: number;
}

/** Microwiny rozpadlé na kořenové kategorie. */
export function byRootCategory(state: MicroWinsState): CategoryStat[] {
  const roots = state.nodes.filter((n) => n.parentId === null);
  return roots
    .map((node) => {
      const ids = new Set(subtreeIds(state.nodes, node.id));
      return { node, count: state.microwins.filter((m) => ids.has(m.metricId)).length };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface MetricStat {
  metric: TreeNode;
  path: string;
  count: number;
  lastDate: ISODate | null;
}

export function byMetric(state: MicroWinsState): MetricStat[] {
  const map = new Map<string, MetricStat>();
  for (const m of state.microwins) {
    const metric = nodeById(state.nodes, m.metricId);
    if (!metric) continue;
    const existing = map.get(metric.id);
    if (existing) {
      existing.count++;
      if (!existing.lastDate || m.date > existing.lastDate) existing.lastDate = m.date;
    } else {
      map.set(metric.id, {
        metric,
        path: pathOf(state.nodes, metric.id)
          .slice(0, -1)
          .map((n) => n.name)
          .join(" / "),
        count: 1,
        lastDate: m.date,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
