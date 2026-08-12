/**
 * Nastavení zobrazení - věci, které nepatří do dat, ale mají přežít zavření
 * appky. Bydlí mimo `MicroWinsState`, protože se s nimi nepočítá žádná
 * doménová logika; do zálohy se přidávají zvlášť (viz `backup.ts`).
 *
 * Malý vlastní store místo contextu: mění se párkrát za rok, ale číst ho
 * potřebuje pár komponent naráz. `useSyncExternalStore` si na něj sedne bez
 * dalšího providera.
 */
import { DEFAULT_ODDS, type Odds } from "./pushwin";

/**
 * Barva postupu. Zelená je výchozí - postup je druhá polovina appky a zaslouží
 * si vlastní hlas. Bílá zůstává na výběr pro toho, komu vedle jantaru microwinů
 * dvě barvy vadí.
 */
export type Accent = "green" | "white";

export const ACCENTS: { id: Accent; label: string; hint: string }[] = [
  { id: "green", label: "Zelená", hint: "postup má vlastní barvu" },
  { id: "white", label: "Bílá", hint: "postup mluví jazykem tlačítek" },
];

/** Klíč pro skript v `layout.tsx`, který barvu nasadí ještě před prvním paintem. */
export const ACCENT_KEY = "microwins:accent";

/**
 * Podoba úvodní obrazovky. Každá karta ukazuje stejná data jinak - někdo
 * potřebuje čísla, jiný jeden úkol na teď.
 */
export type Overview = "classic" | "focus" | "board" | "timeline" | "pulse" | "table";

export const OVERVIEWS: { id: Overview; label: string; hint: string }[] = [
  { id: "classic", label: "Přehled", hint: "čtyři dlaždice, dnešní pohyb a nejblíž cíli" },
  { id: "focus", label: "Na řadě", hint: "jeden projekt velký, zbytek drobně pod ním" },
  { id: "board", label: "Nástěnka", hint: "projekty jako dlaždice s kroužkem" },
  { id: "timeline", label: "Osa", hint: "termíny a milníky v pořadí, jak přijdou" },
  { id: "pulse", label: "Tep", hint: "graf denních přírůstků a série" },
  { id: "table", label: "Tabulka", hint: "hustý výpis všech čísel pod sebou" },
];

/** Podoba tlačítka „hotovo" u úkolu s cílem 1. */
export type DoneStyle = "card" | "switch" | "stamp" | "bar" | "segment";

export const DONE_STYLES: { id: DoneStyle; label: string; hint: string }[] = [
  { id: "card", label: "Rámeček", hint: "velká plocha s zaškrtávátkem" },
  { id: "switch", label: "Přepínač", hint: "systémový vypínač s popiskem" },
  { id: "stamp", label: "Razítko", hint: "kruh, do kterého fajfka dosedne" },
  { id: "bar", label: "Pruh", hint: "postup od nuly do stovky jedním ťuknutím" },
  { id: "segment", label: "Dvojice", hint: "nehotovo | hotovo vedle sebe" },
];

export interface Prefs {
  accent: Accent;
  overview: Overview;
  doneStyle: DoneStyle;
  /** PushWiny zapnuté. Odemykají se až po 50 microwinech, viz `pushwin.ts`. */
  pushWins: boolean;
  /** Šance jednotlivých obtížností při losování; poměr, ne procenta. */
  pushOdds: Odds;
}

export const DEFAULT_PREFS: Prefs = {
  accent: "green",
  overview: "classic",
  doneStyle: "card",
  pushWins: false,
  pushOdds: DEFAULT_ODDS,
};

export const PREFS_KEY = "microwins:prefs";

function isAccent(value: unknown): value is Accent {
  return ACCENTS.some((a) => a.id === value);
}

function isOverview(value: unknown): value is Overview {
  return OVERVIEWS.some((o) => o.id === value);
}

function isDoneStyle(value: unknown): value is DoneStyle {
  return DONE_STYLES.some((d) => d.id === value);
}

/** Šance se ukládají jako čísla 0-100; nesmysl spadne na výchozí poměr. */
function parseOdds(raw: unknown): Odds {
  if (typeof raw !== "object" || raw === null) return DEFAULT_ODDS;
  const record = raw as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const easy = num(record.easy);
  const medium = num(record.medium);
  const hard = num(record.hard);
  if (easy === null || medium === null || hard === null) return DEFAULT_ODDS;
  if (easy + medium + hard === 0) return DEFAULT_ODDS;
  return { easy, medium, hard };
}

/**
 * Z uložených dat bere jen to, co zná - zbytek nechává na výchozím. Díky tomu
 * projdou i starší zálohy: zrušené volby (pět odstínů zelené, pohledy na winy)
 * se tiše zahodí a nastavení spadne na výchozí.
 */
export function parsePrefs(raw: unknown): Prefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const record = raw as Record<string, unknown>;
  return {
    accent: isAccent(record.accent) ? record.accent : DEFAULT_PREFS.accent,
    overview: isOverview(record.overview) ? record.overview : DEFAULT_PREFS.overview,
    doneStyle: isDoneStyle(record.doneStyle) ? record.doneStyle : DEFAULT_PREFS.doneStyle,
    pushWins: record.pushWins === true,
    pushOdds: parseOdds(record.pushOdds),
  };
}

/**
 * Nasadí barvu na <html>. Vedle atributu se ukládá i zvlášť do localStorage,
 * aby ji skript v hlavičce našel dřív, než se rozjede React - jinak by první
 * snímek probliknul výchozí zelenou.
 */
export function applyAccent(accent: Accent): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.accent = accent;
  try {
    window.localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // soukromý režim - barva vydrží do zavření appky
  }
}

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

/**
 * Snímek pro `useSyncExternalStore` - musí mít stálou identitu, dokud se nic
 * nezmění, jinak by React překresloval při každém renderu.
 */
export function getPrefs(): Prefs {
  if (cache) return cache;
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    cache = raw ? parsePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    cache = DEFAULT_PREFS;
  }
  return cache;
}

/** Snímek pro server/prerender - localStorage tam není. */
export function getDefaultPrefs(): Prefs {
  return DEFAULT_PREFS;
}

export function setPrefs(patch: Partial<Prefs>): void {
  const next = { ...getPrefs(), ...patch };
  cache = next;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // soukromý režim - volba vydrží aspoň do zavření appky
  }
  for (const fn of listeners) fn();
}

export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Přepíše nastavení načtené ze zálohy. */
export function replacePrefs(prefs: Prefs): void {
  cache = null;
  setPrefs(prefs);
}
