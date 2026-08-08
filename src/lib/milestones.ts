/**
 * Milníky microwinů - odvozené, ne uložené.
 *
 * Nic se nikde nezaškrtává. Milník je čistá funkce stavu: jakmile uživatel
 * na hranici dosáhne, spočítá se jako splněný a zná i den, kdy padl.
 * Proto se "aktualizuje sám" a nemůže se rozejít s daty.
 *
 * Pozor na jméno: `Milestone` v types.ts je projektový milník (ruční, s datem).
 * Tohle je něco jiného.
 */

import type { ISODate, MicroWinsState } from "./types";
import { diffDays } from "./date";
import { plural } from "./utils";

export type MilestoneKind = "total" | "streak" | "activeDays";

export interface WinMilestone {
  id: string;
  kind: MilestoneKind;
  /** Hranice, které je potřeba dosáhnout. */
  target: number;
  label: string;
  /** Kolik uživatel má teď. */
  current: number;
  achieved: boolean;
  /** Den, kdy hranice padla. `null` dokud splněná není. */
  achievedOn: ISODate | null;
}

const TOTAL_STEPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000] as const;
const STREAK_STEPS = [3, 7, 14, 30, 60, 100, 365] as const;
const ACTIVE_DAY_STEPS = [10, 30, 100, 365] as const;

function totalLabel(n: number): string {
  if (n === 1) return "První microwin";
  return `${n} ${plural(n, "microwin", "microwiny", "microwinů")}`;
}

function streakLabel(n: number): string {
  return `Série ${n} ${plural(n, "den", "dny", "dní")}`;
}

function activeDaysLabel(n: number): string {
  return `${n} ${plural(n, "aktivní den", "aktivní dny", "aktivních dní")}`;
}

/** Data microwinů v pořadí, v jakém byly získány. */
function winDatesInOrder(state: MicroWinsState): ISODate[] {
  return [...state.microwins]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((m) => m.date);
}

/** Unikátní dny s microwinem, vzestupně. */
function activeDatesAsc(state: MicroWinsState): ISODate[] {
  return [...new Set(state.microwins.map((m) => m.date))].sort();
}

/**
 * Den, kdy nepřerušená série poprvé dosáhla délky `n`.
 * `null` = takhle dlouhá série ještě nebyla.
 */
function streakReachedOn(datesAsc: ISODate[], n: number): ISODate | null {
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of datesAsc) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    prev = d;
    if (run >= n) return d;
  }
  return null;
}

/** Nejdelší série, jaká kdy byla. */
function longestStreak(datesAsc: ISODate[]): number {
  let longest = 0;
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of datesAsc) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    prev = d;
    if (run > longest) longest = run;
  }
  return longest;
}

export function winMilestones(state: MicroWinsState): WinMilestone[] {
  const winDates = winDatesInOrder(state);
  const activeDates = activeDatesAsc(state);
  const best = longestStreak(activeDates);

  const totals = TOTAL_STEPS.map<WinMilestone>((target) => ({
    id: `total-${target}`,
    kind: "total",
    target,
    label: totalLabel(target),
    current: winDates.length,
    achieved: winDates.length >= target,
    achievedOn: winDates.length >= target ? winDates[target - 1] : null,
  }));

  const streaksList = STREAK_STEPS.map<WinMilestone>((target) => {
    const on = streakReachedOn(activeDates, target);
    return {
      id: `streak-${target}`,
      kind: "streak",
      target,
      label: streakLabel(target),
      current: best,
      achieved: on !== null,
      achievedOn: on,
    };
  });

  const days = ACTIVE_DAY_STEPS.map<WinMilestone>((target) => ({
    id: `days-${target}`,
    kind: "activeDays",
    target,
    label: activeDaysLabel(target),
    current: activeDates.length,
    achieved: activeDates.length >= target,
    achievedOn: activeDates.length >= target ? activeDates[target - 1] : null,
  }));

  return [...totals, ...streaksList, ...days];
}

/** Nejbližší nesplněný milník každého druhu - to, na co se teď hraje. */
export function nextMilestones(state: MicroWinsState): WinMilestone[] {
  const all = winMilestones(state);
  const kinds: MilestoneKind[] = ["total", "streak", "activeDays"];
  return kinds
    .map((k) => all.find((m) => m.kind === k && !m.achieved))
    .filter((m): m is WinMilestone => m !== undefined);
}

/** Splněné milníky, naposledy dosažený první. */
export function achievedMilestones(state: MicroWinsState): WinMilestone[] {
  return winMilestones(state)
    .filter((m) => m.achieved)
    .sort((a, b) => (b.achievedOn ?? "").localeCompare(a.achievedOn ?? "") || b.target - a.target);
}
