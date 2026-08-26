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

/**
 * Záložky nad projektovou polovinou appky. Jejich pořadí si uživatel skládá
 * v Nastavení, takže seznam nemůže bydlet v komponentě, která je kreslí -
 * nastavení by na něj muselo sáhnout skrz.
 */
export type HubTab = "overview" | "todo" | "plan" | "projects";

export const HUB_TABS: { id: HubTab; label: string }[] = [
  { id: "overview", label: "Přehled" },
  { id: "todo", label: "ToDo" },
  { id: "plan", label: "Plán" },
  { id: "projects", label: "Projekty" },
];

export const DEFAULT_TAB_ORDER: HubTab[] = ["overview", "todo", "plan", "projects"];

/**
 * Vypínatelné části appky. Přidání dalšího addonu je jeden řádek v `ADDONS`
 * a jedna položka v `DEFAULT_ADDONS` - všechno ostatní (obrazovka v Nastavení,
 * načítání i ukládání) jede z tohohle seznamu.
 */
export type AddonId = "overview" | "todo" | "plan";

export const ADDONS: { id: AddonId; label: string; hint: string }[] = [
  { id: "overview", label: "Přehled", hint: "úvodní obrazovka s celkovou statistikou" },
  { id: "todo", label: "ToDo", hint: "krátký seznam na dnešek vedle projektů" },
  { id: "plan", label: "Plán dne", hint: "časové bloky - kdy na co bude čas" },
];

export type Addons = Record<AddonId, boolean>;

export const DEFAULT_ADDONS: Addons = {
  overview: true,
  todo: true,
  plan: true,
};

/** Záložka, kterou vypnutý addon schová. Addon bez záložky sem nepatří. */
export const ADDON_TAB: Partial<Record<AddonId, HubTab>> = {
  overview: "overview",
  todo: "todo",
  plan: "plan",
};

export interface Prefs {
  accent: Accent;
  overview: Overview;
  /** Nové logo z fotky v hlavičce místo samotného textu. */
  headerLogo: boolean;
  /** Ukázat oranžový pohár u složky, když v ní přibyl microwin dnes. */
  folderTrophy: boolean;
  /** Zapnuté části appky, viz `ADDONS`. */
  addons: Addons;
  /** Pořadí záložek zleva doprava. Vždy obsahuje všechny, jen jinak seřazené. */
  tabOrder: HubTab[];
  /**
   * Mizí odškrtnuté položky ToDo samy? Vypnuté mizení si dobu pamatuje, takže
   * zpětné zapnutí vrátí to, co si člověk nastavil - proto dvě volby, ne jedna
   * s nulou.
   */
  todoExpire: boolean;
  /** Za jak dlouho odškrtnutá položka zmizí, v minutách. */
  todoTtlMinutes: number;
}

/** Doby, ze kterých se v Nastavení vybírá. Víc voleb by z toho udělalo formulář. */
export const TODO_TTL_CHOICES = [15, 60, 180, 360, 720, 1440] as const;

export const DEFAULT_TODO_TTL_MINUTES = 360;

export const DEFAULT_PREFS: Prefs = {
  accent: "green",
  overview: "pulse",
  headerLogo: false,
  folderTrophy: false,
  addons: DEFAULT_ADDONS,
  tabOrder: DEFAULT_TAB_ORDER,
  todoExpire: true,
  todoTtlMinutes: DEFAULT_TODO_TTL_MINUTES,
};

export const PREFS_KEY = "microwins:prefs";

function isAccent(value: unknown): value is Accent {
  return ACCENTS.some((a) => a.id === value);
}

function isOverview(value: unknown): value is Overview {
  return OVERVIEWS.some((o) => o.id === value);
}

/**
 * Uložené pořadí je jen nápověda, ne pravda: nová záložka v appce v něm ještě
 * není a zrušená v něm zůstala. Bere se proto průnik se seznamem, který appka
 * opravdu má, a chybějící se doplní na konec ve výchozím pořadí.
 */
export function parseTabOrder(raw: unknown): HubTab[] {
  const known = new Set<string>(HUB_TABS.map((t) => t.id));
  const seen = new Set<HubTab>();
  const out: HubTab[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !known.has(value)) continue;
      const tab = value as HubTab;
      if (seen.has(tab)) continue;
      seen.add(tab);
      out.push(tab);
    }
  }
  for (const tab of DEFAULT_TAB_ORDER) if (!seen.has(tab)) out.push(tab);
  return out;
}

/** Chybějící addon je zapnutý - přidání nového nesmí zhasnout appku uživateli. */
export function parseAddons(raw: unknown): Addons {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_ADDONS };
  for (const addon of ADDONS) {
    if (addon.id in record) out[addon.id] = record[addon.id] !== false;
  }
  return out;
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
    headerLogo: record.headerLogo === true,
    folderTrophy: record.folderTrophy === true,
    addons: parseAddons(record.addons),
    tabOrder: parseTabOrder(record.tabOrder),
    // Chybějící volba = mizení zapnuté, jako to bylo napevno předtím.
    todoExpire: record.todoExpire !== false,
    todoTtlMinutes: parseTtlMinutes(record.todoTtlMinutes),
  };
}

/** Doba mimo rozsah by znamenala buď mizení "hned", nebo nikdy - obojí omylem. */
function parseTtlMinutes(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_TODO_TTL_MINUTES;
  return Math.min(7 * 24 * 60, Math.max(1, Math.round(raw)));
}

/**
 * Doba do smazání v milisekundách, jak ji chtějí funkce v `lib/todos.ts`.
 * Vypnuté mizení je nula - jedno číslo se protáhne všemi výpočty líp než
 * dvojice hodnota + vypínač.
 */
export function todoTtlMs(prefs: Prefs): number {
  return prefs.todoExpire ? prefs.todoTtlMinutes * 60_000 : 0;
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
