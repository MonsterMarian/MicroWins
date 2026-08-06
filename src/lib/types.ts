/**
 * Datový model MicroWins.
 *
 * Strom: uzly typu `category` mohou obsahovat další kategorie i metriky.
 * Uzel typu `metric` je list stromu - drží šablonu textu s "X" a záznamy.
 *
 *  - Business                      (category)
 *  -- cold calls                   (category)
 *  --- X cold calls za den         (metric)
 *      [2; 1.1.2026] [4; 5.6.2026] (entries)
 */

/** Datum ve tvaru YYYY-MM-DD (lokální den, ne UTC). */
export type ISODate = string;

export type NodeKind = "category" | "metric";

/**
 * Jak se sčítají záznamy ve stejném dni.
 * - `sum` (výchozí): 2 + 3 hovory = 5 za den. Vhodné pro počty, hodiny, km.
 * - `max`: rozhoduje nejlepší jednotlivý pokus (např. max. zvednutá váha).
 */
export type Aggregation = "sum" | "max";

export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  /** Kategorie: název. Metrika: šablona textu s "X", např. "X cold calls za den". */
  name: string;
  /** Jen pro metriku - jednotka do popisků, např. "H" nebo "km". */
  unit?: string;
  /** Jen pro metriku. */
  aggregation?: Aggregation;
  createdAt: string;
}

export interface Entry {
  id: string;
  metricId: string;
  /** Den, ke kterému záznam patří. Výchozí = dnešek, lze zadat i starší. */
  date: ISODate;
  /** Vždy > 0, může být desetinné (2.5). */
  value: number;
  note?: string;
  createdAt: string;
  /** true = záznam byl zapsán zpětně (date !== den zápisu) -> nikdy nedává microwin. */
  backdated: boolean;
}

export interface Microwin {
  id: string;
  metricId: string;
  /** Den, kdy byl microwin získán - vždy den zápisu (dnešek). */
  date: ISODate;
  /** Denní součet metriky v okamžiku udělení. */
  value: number;
  /** Nejlepší denní součet z ostatních dnů před udělením (0 = žádný). */
  previousRecord: number;
  /** true = první záznam metriky vůbec. */
  firstEver: boolean;
  createdAt: string;
}

// --- projekty a úkoly -------------------------------------------------------

/**
 * Druhá polovina aplikace: projekty s procentuálním postupem.
 * Projekt = kontejner úkolů, úkol = číselný cíl (630 / 2000).
 */
export interface Project {
  id: string;
  name: string;
  /** Emoji dlaždice v seznamu. */
  icon: string;
  startDate: ISODate;
  /** null = bez deadlinu. */
  deadline: ISODate | null;
  description: string;
  /** Ruční pořadí v seznamu ("Custom Order"). */
  order: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface Task {
  id: string;
  projectId: string;
  /** Podúkol odkazuje na rodiče; top-level úkol má null. */
  parentId: string | null;
  name: string;
  icon: string;
  /** Cílová hodnota, např. 2000. Musí být > 0. */
  target: number;
  /** Aktuální hodnota, např. 630. */
  current: number;
  /** Jednotka do popisků (ks, km, H). */
  unit?: string;
  /** Krok tlačítek +/-. */
  step: number;
  /** Váha v průměru projektu (1 = běžný úkol). */
  weight: number;
  dueDate: ISODate | null;
  milestoneId: string | null;
  description: string;
  order: number;
  createdAt: string;
  /** Kdy úkol poprvé dosáhl 100 %. */
  completedAt: string | null;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  date: ISODate | null;
  createdAt: string;
}

/**
 * Denní otisk postupu projektu. Bez něj by graf ani deník změn nešly
 * spočítat - aktuální hodnoty úkolů historii neznají.
 */
export interface Snapshot {
  projectId: string;
  date: ISODate;
  percent: number;
}

export interface MicroWinsState {
  version: number;
  nodes: TreeNode[];
  entries: Entry[];
  microwins: Microwin[];
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  snapshots: Snapshot[];
}

export const STATE_VERSION = 2;

export const EMPTY_STATE: MicroWinsState = {
  version: STATE_VERSION,
  nodes: [],
  entries: [],
  microwins: [],
  projects: [],
  tasks: [],
  milestones: [],
  snapshots: [],
};
