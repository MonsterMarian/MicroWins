import type { ISODate } from "./types";

/** Vše počítáme v lokálním čase - "dnešek" je den uživatele, ne UTC. */

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** Parsuje YYYY-MM-DD na lokální Date (poledne, aby DST neposunulo den). */
export function fromISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Počet celých dnů mezi dvěma dny (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const ms = fromISODate(b).getTime() - fromISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = fromISODate(value);
  return toISODate(d) === value;
}

const DAY_NAMES = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const DAY_SHORT = ["ne", "po", "út", "st", "čt", "pá", "so"];

export function dayName(iso: ISODate): string {
  return DAY_NAMES[fromISODate(iso).getDay()];
}

export function dayShort(iso: ISODate): string {
  return DAY_SHORT[fromISODate(iso).getDay()];
}

/** 2026-01-01 -> "1. 1. 2026" */
export function formatDate(iso: ISODate): string {
  const d = fromISODate(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** Krátký, lidský popis dne. */
export function formatDateRelative(iso: ISODate, today: ISODate = todayISO()): string {
  const diff = diffDays(iso, today);
  if (diff === 0) return "dnes";
  if (diff === 1) return "včera";
  if (diff === 2) return "předevčírem";
  if (diff > 0 && diff < 7) return `před ${diff} dny`;
  return formatDate(iso);
}

/** Číslo dne v měsíci (1-31). */
export function dayOfMonth(iso: ISODate): number {
  return fromISODate(iso).getDate();
}

/** Pondělkem začínající týden (0 = pondělí). */
export function weekdayMondayFirst(iso: ISODate): number {
  return (fromISODate(iso).getDay() + 6) % 7;
}

/** Pondělí týdne, do kterého datum spadá. Identita týdne u PushWinů. */
export function weekStart(iso: ISODate): ISODate {
  return addDays(iso, -weekdayMondayFirst(iso));
}

/** Neděle téhož týdne - poslední den, kdy jde výzvu splnit. */
export function weekEnd(iso: ISODate): ISODate {
  return addDays(weekStart(iso), 6);
}

const MONTHS = [
  "led",
  "úno",
  "bře",
  "dub",
  "kvě",
  "čvn",
  "čvc",
  "srp",
  "zář",
  "říj",
  "lis",
  "pro",
];

export function monthShort(iso: ISODate): string {
  return MONTHS[fromISODate(iso).getMonth()];
}

const MONTH_NAMES = [
  "leden",
  "únor",
  "březen",
  "duben",
  "květen",
  "červen",
  "červenec",
  "srpen",
  "září",
  "říjen",
  "listopad",
  "prosinec",
];

/** "srpen 2026" */
export function monthLabel(iso: ISODate): string {
  const d = fromISODate(iso);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function yearOf(iso: ISODate): number {
  return Number(iso.slice(0, 4));
}

/** Všechny dny měsíce, do kterého datum spadá (1. až poslední). */
export function monthDays(iso: ISODate): ISODate[] {
  const d = fromISODate(iso);
  const year = d.getFullYear();
  const month = d.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) => toISODate(new Date(year, month, i + 1, 12)));
}
