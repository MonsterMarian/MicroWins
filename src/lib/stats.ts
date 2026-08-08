import { addDays, diffDays, todayISO, weekdayMondayFirst } from "./date";
import { breadcrumb, formatMetricLabel, nodeById, pathOf, subtreeIds } from "./domain";
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
}

/** Mřížka posledních `weeks` týdnů (sloupec = týden od pondělí). */
export function heatmap(
  state: MicroWinsState,
  today: ISODate = todayISO(),
  weeks = 18,
): HeatCell[][] {
  const counts = new Map<ISODate, number>();
  for (const r of dayRows(state)) counts.set(r.date, r.count);

  // začni pondělkem týdne, do kterého spadá today - (weeks-1) týdnů
  const startOfThisWeek = addDays(today, -weekdayMondayFirst(today));
  const start = addDays(startOfThisWeek, -(weeks - 1) * 7);

  const grid: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      column.push({ date, count: counts.get(date) ?? 0, future: date > today });
    }
    grid.push(column);
  }
  return grid;
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
