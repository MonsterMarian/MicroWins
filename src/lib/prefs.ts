/**
 * Nastavení zobrazení - věci, které nepatří do dat, ale mají přežít zavření
 * appky. Bydlí mimo `MicroWinsState`, protože se s nimi nepočítá žádná
 * doménová logika; do zálohy se přidávají zvlášť (viz `backup.ts`).
 *
 * Malý vlastní store místo contextu: mění se párkrát za rok, ale číst ho
 * potřebuje pár komponent naráz. `useSyncExternalStore` si na něj sedne bez
 * dalšího providera.
 */

/**
 * Zelená, kterou kreslí postup projektů (pruhy, procenta, hotové úkoly).
 * Jantar u microwinů zůstává - to je druhý, sémanticky jiný akcent.
 *
 * Odstíny drží pásmo 130-176°. Dolní hranici určuje naše oranžová (68°):
 * blíž než 60° se obě barvy na obrazovce začnou plést. Sytost je u každé
 * odstupňovaná od hranice sRGB pro daný odstín - proto je Terminál (145°,
 * kde má gamut zelené špičku) nejostřejší a Mech nejtlumenější.
 */
export type Accent = "acid" | "terminal" | "emerald" | "mint" | "moss";

export const ACCENTS: { id: Accent; label: string; hint: string }[] = [
  { id: "terminal", label: "Terminál", hint: "fosforová zeleň starých monitorů" },
  { id: "acid", label: "Kyselina", hint: "žlutozelená, nejblíž oranžové" },
  { id: "emerald", label: "Smaragd", hint: "čistá zeleň, nic nepřehluší" },
  { id: "mint", label: "Mentol", hint: "chladná, blíž tyrkysu" },
  { id: "moss", label: "Mech", hint: "tlumená, jediná nekřičí" },
];

/** Klíč pro skript v `layout.tsx`, který barvu nasadí ještě před prvním paintem. */
export const ACCENT_KEY = "microwins:accent";

export interface Prefs {
  accent: Accent;
}

export const DEFAULT_PREFS: Prefs = {
  accent: "terminal",
};

export const PREFS_KEY = "microwins:prefs";

function isAccent(value: unknown): value is Accent {
  return ACCENTS.some((a) => a.id === value);
}

/**
 * Z uložených dat bere jen to, co zná - zbytek nechává na výchozím. Díky tomu
 * projdou i starší zálohy: zrušené volby (nefrit, limetka, šalvěj, pohledy na
 * winy) se tiše zahodí a nastavení spadne na výchozí zelenou.
 */
export function parsePrefs(raw: unknown): Prefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const record = raw as Record<string, unknown>;
  return {
    accent: isAccent(record.accent) ? record.accent : DEFAULT_PREFS.accent,
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
