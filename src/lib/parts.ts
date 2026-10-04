import type { AddonId } from "./prefs";
import { descendantsOf, projectById, taskById } from "./projects";
import { blockTitle } from "./timeblocks";
import { EMPTY_STATE, type MicroWinsState, type Task } from "./types";
import { plural } from "./utils";

/**
 * Části dat - to, co se dá uložit a načíst samostatně.
 *
 * Dřív šla ven jen celá záloha a načíst se dal jen strom, nebo "projekty"
 * i se vším, co k nim appka postupně přidala (ToDo, plán, time box). Addony
 * ale žijí každý svým životem: kdo si chce přenést seznam na dnešek do
 * tabletu, nemá kvůli tomu tahat projekty a přepisovat si plán.
 *
 * Část je pojmenovaná sada kolekcí ze stavu. Sady se smějí překrývat - time
 * box **nemá vlastní mřížku**, jeho zápisy jsou bloky Plánu dne, takže bez
 * bloků by z uloženého time boxu zbyly jen tři priority a brain dump. Kdo
 * vybere obojí, dostane bloky jednou; skládá se sjednocení kolekcí.
 *
 * Atomy vlastní část nemají: atom **je** podúkol, takže se ukládá s projekty.
 * Jednotlivá mapa se dá uložit zvlášť přímo nad ní (`pickTaskTree`).
 */
export type DataPart = "tree" | "projects" | "todo" | "plan" | "timebox";

export type StateKey = Exclude<keyof MicroWinsState, "version">;

export interface PartInfo {
  id: DataPart;
  label: string;
  hint: string;
  keys: readonly StateKey[];
  /**
   * Zrušená část, která se už nenabízí k uložení, ale pořád se čte ze souborů
   * z dřívějška. Plán dne padl - jeho bloky dnes patří mřížce time boxu -
   * ale záloha s částí „plan" se musí načíst celá, jinak by přišla o bloky.
   */
  legacy?: boolean;
}

export const DATA_PARTS: readonly PartInfo[] = [
  {
    id: "tree",
    label: "Strom winů",
    hint: "složky, winy, záznamy a microwiny",
    keys: ["nodes", "entries", "microwins"],
  },
  {
    id: "projects",
    label: "Projekty a atomy",
    hint: "úkoly i jejich rozsekání, milníky a historie postupu",
    keys: ["projects", "tasks", "milestones", "snapshots", "taskSnapshots"],
  },
  { id: "todo", label: "ToDo", hint: "seznam i s termíny", keys: ["todos"] },
  {
    id: "timebox",
    label: "Time box",
    hint: "priority, brain dump a zápisy v mřížce (bloky času)",
    keys: ["daySheets", "timeBlocks"],
  },
];

/** Zrušené části - k uložení se nenabízí, ale staré soubory je obsahují. */
const LEGACY_PARTS: readonly PartInfo[] = [
  { id: "plan", label: "Plán dne", hint: "časové bloky", keys: ["timeBlocks"], legacy: true },
];

/** Všechno, co se umí přečíst ze souboru: dnešní i zrušené části. */
const KNOWN_PARTS: readonly PartInfo[] = [...DATA_PARTS, ...LEGACY_PARTS];

export const ALL_PARTS: readonly DataPart[] = DATA_PARTS.map((p) => p.id);

/**
 * Kterou část ukládá který addon. Přehled vlastní data nemá - jen počítá
 * z ostatních - a atomy jsou úkoly, takže jdou s projekty.
 */
export const ADDON_PART: Partial<Record<AddonId, DataPart>> = {
  todo: "todo",
  timebox: "timebox",
  atoms: "projects",
};

export function partInfo(part: DataPart): PartInfo {
  return KNOWN_PARTS.find((p) => p.id === part) as PartInfo;
}

export function isDataPart(value: unknown): value is DataPart {
  return KNOWN_PARTS.some((p) => p.id === value);
}

/** Jsou vybrané všechny části? Taková záloha je úplná a nese i nastavení. */
export function isAllParts(parts: readonly DataPart[]): boolean {
  return ALL_PARTS.every((p) => parts.includes(p));
}

/** Kolekce, které vybrané části pokrývají - bez opakování. */
export function partKeys(parts: readonly DataPart[]): Set<StateKey> {
  return new Set(KNOWN_PARTS.filter((p) => parts.includes(p.id)).flatMap((p) => p.keys));
}

/**
 * Stav oříznutý na vybrané části; ostatní kolekce jsou prázdné.
 *
 * Blok plánu bez svého úkolu nebo položky ToDo v souboru po načtení odkaz
 * ztratí a zbyde mu jen text, se kterým kdysi vznikl - a ten může být dávno
 * zastaralý (úkol se mezitím přejmenoval). Do souboru se proto píše popisek,
 * jaký blok ukazuje **teď**. Úplná záloha se nechává beze změny do písmene.
 */
export function pickParts(state: MicroWinsState, parts: readonly DataPart[]): MicroWinsState {
  if (isAllParts(parts)) return state;
  const keys = partKeys(parts);
  const out: MicroWinsState = { ...EMPTY_STATE, version: state.version };
  for (const key of keys) (out as unknown as Record<StateKey, unknown>)[key] = state[key];
  if (keys.has("timeBlocks")) {
    out.timeBlocks = state.timeBlocks.map((b) => {
      const title = blockTitle(state, b);
      return title === b.title ? b : { ...b, title };
    });
  }
  return out;
}

/**
 * Které části ve stavu opravdu něco mají. Zrušené části se počítají taky -
 * náhled načtení má u starého souboru ukázat „Plán dne", ne prázdný seznam.
 * U souborů z dneška se zrušená část odfiltruje přes seznam částí v souboru.
 */
export function partsIn(state: MicroWinsState): DataPart[] {
  return KNOWN_PARTS.filter((p) => partSize(state, p.id) > 0).map((p) => p.id);
}

function partSize(state: MicroWinsState, part: DataPart): number {
  switch (part) {
    case "tree":
      return state.nodes.length;
    case "projects":
      return state.projects.length;
    case "todo":
      return state.todos.length;
    case "plan":
      return state.timeBlocks.length;
    case "timebox":
      return state.daySheets.length;
  }
}

/** Krátký popis obsahu části pro výběr v dialogu: "3 projekty, 12 úkolů". */
export function describePart(state: MicroWinsState, part: DataPart): string {
  switch (part) {
    case "tree": {
      const folders = state.nodes.filter((n) => n.kind === "category").length;
      const wins = state.nodes.length - folders;
      return `${folders} ${plural(folders, "složka", "složky", "složek")}, ${wins} ${plural(wins, "win", "winy", "winů")}`;
    }
    case "projects": {
      const n = state.projects.length;
      const t = state.tasks.length;
      return `${n} ${plural(n, "projekt", "projekty", "projektů")}, ${t} ${plural(t, "úkol", "úkoly", "úkolů")}`;
    }
    case "todo": {
      const n = state.todos.length;
      return `${n} ${plural(n, "položka", "položky", "položek")}`;
    }
    case "plan": {
      const n = state.timeBlocks.length;
      return `${n} ${plural(n, "blok", "bloky", "bloků")}`;
    }
    case "timebox": {
      // Bloky se počítají taky - mřížka time boxu z nich celá stojí.
      const n = state.daySheets.length;
      const b = state.timeBlocks.length;
      const days = `${n} ${plural(n, "den", "dny", "dnů")}`;
      return b > 0 ? `${days}, ${b} ${plural(b, "blok", "bloky", "bloků")}` : days;
    }
  }
}

/**
 * Jedna mapa atomů jako samostatný soubor: úkol s celým podstromem, jeho
 * otisky a projekt, do kterého patří - ten jen jako obal, aby šel soubor
 * načíst i obyčejnou obnovou v Nastavení.
 *
 * Milníky se nepřibalují (patří projektu, ne mapě), takže vazba na ně se
 * rovnou utrhne, místo aby v souboru ukazovala do prázdna.
 */
export function pickTaskTree(state: MicroWinsState, rootId: string): MicroWinsState {
  const root = taskById(state, rootId);
  if (!root) return { ...EMPTY_STATE, version: state.version };
  const project = projectById(state, root.projectId);
  const tasks = [{ ...root, parentId: null }, ...descendantsOf(state, rootId)].map((t) =>
    t.milestoneId === null ? t : { ...t, milestoneId: null },
  );
  const ids = new Set(tasks.map((t) => t.id));

  return {
    ...EMPTY_STATE,
    version: state.version,
    projects: project ? [{ ...project, order: 0 }] : [],
    tasks,
    taskSnapshots: state.taskSnapshots.filter((s) => ids.has(s.taskId)),
  };
}

/**
 * Mapy v souboru - úkoly, nad kterými v něm nic není. Soubor jedné mapy jich
 * má jednu, celá záloha tolik, kolik je v projektech úkolů nejvyšší úrovně.
 * Řazení jde po projektech a v nich podle ručního pořadí, jak je zná lišta.
 */
export function mapRoots(state: MicroWinsState): Task[] {
  const ids = new Set(state.tasks.map((t) => t.id));
  const projectRank = new Map(
    [...state.projects].sort((a, b) => a.order - b.order).map((p, i) => [p.id, i]),
  );
  return state.tasks
    .filter((t) => t.parentId === null || !ids.has(t.parentId))
    .sort(
      (a, b) =>
        (projectRank.get(a.projectId) ?? Infinity) - (projectRank.get(b.projectId) ?? Infinity) ||
        a.order - b.order ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** Jméno do souboru bez diakritiky a mezer: "Spustit web" → "spustit-web". */
export function fileSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}
