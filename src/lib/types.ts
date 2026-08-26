/**
 * Datový model MicroWins.
 *
 * Strom: uzly typu `category` mohou obsahovat další kategorie i všechny tři
 * druhy winů. Winy jsou vždy listy stromu.
 *
 *  - Business                      (category)
 *  -- cold calls                   (category)
 *  --- X cold calls za den         (metric - číslo, honí se rekord)
 *      [2; 1.1.2026] [4; 5.6.2026] (entries)
 *  -- Ranní protažení              (check - jen ANO, opakuje se)
 *      [1; 5.8.2026] [1; 6.8.2026] (entries, hodnota vždy 1)
 *  -- Odeslal jsem první nabídku   (once - stane se jednou, poznámka + datum)
 *      [1; 2.8.2026]               (jediný entry)
 */

/** Datum ve tvaru YYYY-MM-DD (lokální den, ne UTC). */
export type ISODate = string;

/**
 * - `category`: složka, může obsahovat další složky i winy.
 * - `metric`: číselný win. Microwin padne, když denní součet překoná rekord.
 * - `check`: nekvantifikovatelný opakovaný win. Zaškrtnutí dne = microwin dne.
 * - `once`: jednorázový win. Zapíše se jednou, k jednomu dni, a je hotový.
 */
export type NodeKind = "category" | "metric" | "check" | "once";

/** Winy jsou listy stromu - všechno kromě kategorie. */
export const WIN_KINDS = ["metric", "check", "once"] as const satisfies readonly NodeKind[];

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
  /**
   * Kategorie: název. Metrika: šablona textu s "X" ("X cold calls za den").
   * Check a once: prostý text winu ("Ranní protažení").
   */
  name: string;
  /**
   * Ikona složky - emoji nebo `lucide:Jméno`, stejný zápis jako u projektů.
   * Nevyplněno = kreslená složka, takže starší data vypadají jako dřív.
   */
  icon?: string;
  /** Jen pro metriku - jednotka do popisků, např. "H" nebo "km". */
  unit?: string;
  /** Jen pro metriku. */
  aggregation?: Aggregation;
  createdAt: string;
  /**
   * Kdy byl uzel odložen do archivu (ISO); chybí nebo null = běžný uzel.
   *
   * Archivovaný uzel zmizí ze stromu i s celým podstromem - nezakládá se do
   * něj a nic se do něj nezapisuje. Data ale zůstávají: microwiny, záznamy
   * i rekordy se dál počítají do statistik, jinak by archivace vypadala jako
   * mazání s jiným názvem.
   */
  archivedAt?: string | null;
}

export interface Entry {
  id: string;
  /** Uzel, ke kterému záznam patří (metric, check i once). */
  metricId: string;
  /** Den, ke kterému záznam patří. Výchozí = dnešek, lze zadat i starší. */
  date: ISODate;
  /** Vždy > 0, může být desetinné (2.5). U check a once vždy 1. */
  value: number;
  note?: string;
  createdAt: string;
  /** true = záznam byl zapsán zpětně (date !== den zápisu). */
  backdated: boolean;
}

export interface Microwin {
  id: string;
  /** Uzel, ke kterému microwin patří (metric, check i once). */
  metricId: string;
  /** Den, ke kterému microwin patří. */
  date: ISODate;
  /** Denní součet metriky v okamžiku udělení. U check a once vždy 1. */
  value: number;
  /** Nejlepší denní součet z ostatních dnů před udělením (0 = žádný). */
  previousRecord: number;
  /** true = první záznam uzlu vůbec. */
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

/**
 * Mezizastávka projektu. Odškrtává se ručně a **do procent projektu ani úkolů
 * se nepočítá** - je to poznámka na ose, ne kus práce. Kdyby milník procenta
 * hýbal, počítala by se stejná práce dvakrát: jednou v úkolu, podruhé
 * v milníku, který ten úkol shrnuje.
 */
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  date: ISODate | null;
  createdAt: string;
  /** Kdy ho uživatel odškrtl; null = ještě ne. */
  doneAt: string | null;
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

/**
 * Totéž pro jednotlivý úkol. Zapisuje se jen při skutečné změně, takže
 * u nedotčeného úkolu nepřibývá řádek za den - jinak by dvacet úkolů za rok
 * nadělalo sedm tisíc záznamů, které nikdo nikdy nepřečte.
 */
export interface TaskSnapshot {
  taskId: string;
  date: ISODate;
  percent: number;
}

// --- ToDo -------------------------------------------------------------------

/**
 * Obyčejný seznam na dnešek. Schválně nemá nic z projektů - žádná procenta,
 * cíle, jednotky ani váhy. Napsat, odškrtnout, zapomenout: kdyby si položka
 * žádala nastavení, byl by to úkol a ten už v appce je.
 *
 * Odškrtnutá položka se **sama smaže** po době z Nastavení (výchozí
 * `TODO_TTL_MS`, dá se i vypnout). Do té doby zůstane dole pod otevřenými,
 * aby se šlo přesvědčit, že se to opravdu stalo, a šla vrátit omylem
 * odškrtnutá věc.
 *
 * Jediné nepovinné nastavení položky je termín - a i ten se přidává až
 * dodatečně, aby se zakládání drželo na "napsat a Enter".
 */
export interface Todo {
  id: string;
  text: string;
  createdAt: string;
  /** Čas odškrtnutí (ISO); null = otevřená položka. Od něj běží mazání. */
  doneAt: string | null;
  /** Ruční pořadí mezi otevřenými položkami. */
  order: number;
  /**
   * Kdy to má být hotové. Nepovinné a přidává se **až k hotové položce** -
   * psaní seznamu se tím nesmí zdržet. `null` = položka bez termínu, což je
   * ten běžný případ.
   */
  dueDate: ISODate | null;
  /** Hodina termínu "HH:MM". Bez `dueDate` nedává smysl a drží se na null. */
  dueTime: string | null;
}

/** Výchozí doba, za kterou odškrtnutá položka zmizí. Jde přenastavit v Nastavení. */
export const TODO_TTL_MS = 6 * 60 * 60 * 1000;

// --- časové bloky -----------------------------------------------------------

/**
 * Timeblocking: den rozkrájený na bloky. Blok je **kus času**, ne úkol - nemá
 * procenta ani cíl, jen začátek a délku. Co se v něm dělá, může být buď
 * napsané rovnou (`title`), nebo převzaté z položky ToDo či úkolu projektu.
 *
 * Odkaz drží jen id, ne kopii textu: přejmenovaný úkol se má propsat i do
 * plánu. Když odkazovaná věc zmizí, blok zůstane s tím, co se do něj napsalo
 * při zakládání - vyhozený řádek z plánu dne by byl horší než blok, který
 * nikam nevede.
 */
export interface TimeBlock {
  id: string;
  /** Den, do kterého blok patří. */
  date: ISODate;
  /** Začátek v minutách od půlnoci (0-1439). */
  start: number;
  /** Délka v minutách. */
  duration: number;
  /** Popisek bloku. U bloku z úkolu se drží jako záloha, kdyby úkol zmizel. */
  title: string;
  /** Položka ToDo, ze které blok vznikl; null = blok napsaný ručně. */
  todoId: string | null;
  /** Úkol projektu, ze kterého blok vznikl. */
  taskId: string | null;
  createdAt: string;
  /** Kdy se blok odškrtl; null = ještě ne. */
  doneAt: string | null;
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
  taskSnapshots: TaskSnapshot[];
  todos: Todo[];
  timeBlocks: TimeBlock[];
}

export const STATE_VERSION = 7;

export const EMPTY_STATE: MicroWinsState = {
  version: STATE_VERSION,
  nodes: [],
  entries: [],
  microwins: [],
  projects: [],
  tasks: [],
  milestones: [],
  snapshots: [],
  taskSnapshots: [],
  todos: [],
  timeBlocks: [],
};
