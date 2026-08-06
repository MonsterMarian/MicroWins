import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function createId(prefix = "id"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

/** Čísla zobrazujeme česky: 4 -> "4", 2.5 -> "2,5". */
export function formatNumber(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 4 }).format(rounded);
}

/** Přijímá "2.5" i české "2,5". Prázdný vstup -> NaN. */
export function parseNumber(input: string): number {
  const cleaned = input.trim().replace(",", ".");
  if (!cleaned) return NaN;
  return Number(cleaned);
}

/** "5 microwinů" - české skloňování. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
