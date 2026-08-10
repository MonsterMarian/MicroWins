/**
 * Nastavení zobrazení - věci, které nepatří do dat, ale mají přežít zavření
 * appky. Bydlí mimo `MicroWinsState`, protože se s nimi nepočítá žádná
 * doménová logika; do zálohy se přidávají zvlášť (viz `backup.ts`).
 *
 * Malý vlastní store místo contextu: mění se párkrát za rok, ale číst ho
 * potřebuje pár komponent naráz. `useSyncExternalStore` si na něj sedne bez
 * dalšího providera.
 */

/** Jak vypadá sekce s winy v Analýze. */
export type WinsView = "compact" | "progress" | "focus" | "ranking" | "table";

export const WINS_VIEWS: { id: WinsView; label: string; hint: string }[] = [
  { id: "compact", label: "Stručně", hint: "jeden řádek na win, rekord a dnešek" },
  { id: "progress", label: "Postup k rekordu", hint: "jak blízko jsi dnes rekordu" },
  { id: "focus", label: "Dnešek", hint: "co dnes padlo a co je na dosah" },
  { id: "ranking", label: "Žebříček", hint: "winy podle počtu microwinů" },
  { id: "table", label: "Úplná tabulka", hint: "všechny sloupce, nejvíc čísel" },
];

export interface Prefs {
  winsView: WinsView;
}

export const DEFAULT_PREFS: Prefs = {
  winsView: "compact",
};

export const PREFS_KEY = "microwins:prefs";

function isWinsView(value: unknown): value is WinsView {
  return WINS_VIEWS.some((v) => v.id === value);
}

/** Z uložených dat bere jen to, co zná - zbytek nechává na výchozím. */
export function parsePrefs(raw: unknown): Prefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const record = raw as Record<string, unknown>;
  return {
    winsView: isWinsView(record.winsView) ? record.winsView : DEFAULT_PREFS.winsView,
  };
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
