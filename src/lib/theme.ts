import { syncStatusBar } from "./native";

/**
 * Světlé a tmavé téma.
 *
 * Téma nebydlí v `prefs`: skript v hlavičce (`layout.tsx`) ho musí nasadit
 * dřív, než se rozjede React, jinak by první snímek probliknul. Čte proto
 * vlastní klíč v localStorage. Tady je jen jedno místo, které ho mění a dává
 * o tom vědět - Nastavení, obnova ze zálohy i synchronizace z jiného zařízení.
 */

export type Theme = "dark" | "light";

export const THEME_KEY = "microwins:theme";

const listeners = new Set<() => void>();

/** Téma, které je zrovna vidět (i když ho nikdo nevybral a řídí se systémem). */
export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function getServerTheme(): Theme {
  return "dark";
}

/** Vybrané téma; null = nikdo nevybral, řídí se systémem. */
export function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export function setTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  void syncStatusBar(theme === "dark");
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // soukromý režim - téma vydrží do zavření appky
  }
  for (const fn of listeners) fn();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
