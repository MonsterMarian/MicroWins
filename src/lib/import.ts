import { ALL_PARTS, type DataPart } from "./parts";
import { snapshotProject } from "./project-actions";
import { priorityText } from "./timebox";
import type {
  DaySheet,
  ISODate,
  MicroWinsState,
  Project,
  Snapshot,
  Task,
  TaskSnapshot,
  TimeBlock,
  Todo,
  TreeNode,
} from "./types";
import { createId } from "./utils";

/**
 * Načtení zálohy po částech.
 *
 * Appka drží strom winů, projekty a k nim addony (ToDo, plán, time box). Když
 * si člověk tahá projekty z jiné aplikace, nesmí tím smazat strom, který si
 * tady vede měsíce - a kdo si přenáší jen ToDo, nesmí si tím přepsat plán.
 * Proto se dá vybrat, které části se ze zálohy vezmou (`DataPart`, viz
 * `parts.ts`), a jestli se k existujícím datům přidají, nebo je nahradí
 * (`ImportMode`).
 *
 * Čisté funkce, žádné localStorage - merge je otestovaný bez renderu.
 */

/**
 * Starší zkratky rozsahu z doby, kdy se appka dělila jen na dvě poloviny.
 * "Projekty" tehdy znamenaly i ToDo, plán a time box - tak to i zůstává.
 */
export type ImportScope = "all" | "projects" | "tree";

export function scopeParts(scope: ImportScope): DataPart[] {
  if (scope === "tree") return ["tree"];
  if (scope === "projects") return ALL_PARTS.filter((p) => p !== "tree");
  return [...ALL_PARTS];
}

/**
 * - `add`: přidat k tomu, co v appce je. Příchozí id se přerazí na nová,
 *   takže se nic nemůže potkat se stávajícími daty.
 * - `replace`: zahodit odpovídající část a nahradit ji zálohou.
 */
export type ImportMode = "add" | "replace";

export interface StateCounts {
  folders: number;
  wins: number;
  entries: number;
  microwins: number;
  projects: number;
  tasks: number;
  milestones: number;
  /** Otevřené položky ToDo; odškrtnuté se do zálohy počítat nemají, mizí samy. */
  todos: number;
  /** Bloky v plánu dne. */
  blocks: number;
  /** Dny, ke kterým je v time boxu napsaná priorita nebo brain dump. */
  sheets: number;
}

export function countState(state: MicroWinsState): StateCounts {
  return {
    folders: state.nodes.filter((n) => n.kind === "category").length,
    wins: state.nodes.filter((n) => n.kind !== "category").length,
    entries: state.entries.length,
    microwins: state.microwins.length,
    projects: state.projects.length,
    tasks: state.tasks.length,
    milestones: state.milestones.length,
    todos: state.todos.filter((t) => t.doneAt === null).length,
    blocks: state.timeBlocks.length,
    sheets: state.daySheets.length,
  };
}

/** Záloha nese aspoň jednu z polovin - jinak není co načítat. */
export function hasScope(counts: StateCounts, scope: ImportScope): boolean {
  const tree = counts.folders + counts.wins > 0;
  // ToDo, plán i time box patří k projektové polovině: záloha se samotným
  // seznamem je pořád něco, co má smysl načíst.
  const projects = counts.projects + counts.todos + counts.blocks + counts.sheets > 0;
  if (scope === "tree") return tree;
  if (scope === "projects") return projects;
  return tree || projects;
}

/** Nová id pro celou příchozí sadu - `add` nesmí navázat na stávající data. */
function remap(ids: string[]): Map<string, string> {
  return new Map(ids.map((id) => [id, createId("imp")]));
}

/** Ruční pořadí žije v `order`, ne v pozici v poli - pořadí 0, 1, 2 … podle něj. */
function rankByOrder<T extends { id: string; order: number; createdAt: string }>(
  items: T[],
): Map<string, number> {
  return new Map(
    [...items]
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
      .map((item, i) => [item.id, i]),
  );
}

/**
 * Projekty, úkoly, milníky a otisky z příchozího stavu, případně s novými id.
 * Úkol nebo milník bez svého projektu se zahodí - jinak by v appce zůstal
 * neviditelný záznam, na který se nedá dostat.
 *
 * Vrací i mapu starých id úkolů na nová - bloky plánu se na úkoly odkazují.
 */
function projectPart(
  incoming: MicroWinsState,
  fresh: boolean,
  orderOffset: number,
): {
  part: Pick<MicroWinsState, "projects" | "tasks" | "milestones" | "snapshots" | "taskSnapshots">;
  taskIds: Map<string, string>;
} {
  const projectIds = remap(incoming.projects.map((p) => p.id));
  const taskIds = remap(incoming.tasks.map((t) => t.id));
  const milestoneIds = remap(incoming.milestones.map((m) => m.id));

  const pid = (id: string) => (fresh ? (projectIds.get(id) ?? id) : id);
  const tid = (id: string) => (fresh ? (taskIds.get(id) ?? id) : id);
  const mid = (id: string) => (fresh ? (milestoneIds.get(id) ?? id) : id);

  const known = new Set(incoming.projects.map((p) => p.id));
  const knownTasks = new Set(incoming.tasks.map((t) => t.id));
  const knownMilestones = new Set(incoming.milestones.map((m) => m.id));

  /*
   * Pořadí se přečísluje nahusto (0, 1, 2 …), aby přidané projekty navázaly za
   * stávající a nepřekryly se s nimi. Pořadí se ale musí brát z `order`, ne
   * z pozice v poli: `reorderProjects` přetažením přepisuje jen `order` a pole
   * nechává v pořadí, jak projekty vznikaly. Číslovat podle indexu tedy
   * znamená zahodit ruční uspořádání pokaždé, když si člověk načte zálohu.
   */
  const rank = rankByOrder(incoming.projects);

  const projects: Project[] = incoming.projects.map((p) => ({
    ...p,
    id: pid(p.id),
    order: orderOffset + (rank.get(p.id) ?? 0),
  }));

  const tasks: Task[] = incoming.tasks
    .filter((t) => known.has(t.projectId))
    .map((t) => ({
      ...t,
      id: tid(t.id),
      projectId: pid(t.projectId),
      // Podúkol osiřelého rodiče se povýší na běžný úkol, ať se neztratí.
      parentId: t.parentId && knownTasks.has(t.parentId) ? tid(t.parentId) : null,
      milestoneId:
        t.milestoneId && knownMilestones.has(t.milestoneId) ? mid(t.milestoneId) : null,
    }));

  const milestones = incoming.milestones
    .filter((m) => known.has(m.projectId))
    .map((m) => ({ ...m, id: mid(m.id), projectId: pid(m.projectId) }));

  const snapshots: Snapshot[] = incoming.snapshots
    .filter((s) => known.has(s.projectId))
    .map((s) => ({ ...s, projectId: pid(s.projectId) }));

  const taskSnapshots: TaskSnapshot[] = incoming.taskSnapshots
    .filter((s) => knownTasks.has(s.taskId))
    .map((s) => ({ ...s, taskId: tid(s.taskId) }));

  return {
    part: { projects, tasks, milestones, snapshots, taskSnapshots },
    taskIds: new Map(incoming.tasks.map((t) => [t.id, tid(t.id)])),
  };
}

/**
 * Strom z příchozího stavu, případně s novými id. Uzel, jehož rodič v záloze
 * není, se přesune na kořen - lepší než ho nechat zmizet.
 */
function treePart(
  incoming: MicroWinsState,
  fresh: boolean,
): Pick<MicroWinsState, "nodes" | "entries" | "microwins"> {
  const nodeIds = remap(incoming.nodes.map((n) => n.id));
  const nid = (id: string) => (fresh ? (nodeIds.get(id) ?? id) : id);
  const known = new Set(incoming.nodes.map((n) => n.id));

  const nodes: TreeNode[] = incoming.nodes.map((n) => ({
    ...n,
    id: nid(n.id),
    parentId: n.parentId && known.has(n.parentId) ? nid(n.parentId) : null,
  }));

  const microwinIds = remap(incoming.microwins.map((m) => m.id));
  const wid = (id: string) => (fresh ? (microwinIds.get(id) ?? id) : id);

  /* Záznam má vlastní id stejně jako uzel nebo microwin. Bez přeražení by
     dvojí načtení téže zálohy v režimu `add` vyrobilo dva záznamy se stejným
     id - a `deleteEntry` maže podle id, takže by smazání jednoho sebralo oba. */
  const entryIds = remap(incoming.entries.map((e) => e.id));
  const eid = (id: string) => (fresh ? (entryIds.get(id) ?? id) : id);

  return {
    nodes,
    entries: incoming.entries
      .filter((e) => known.has(e.metricId))
      .map((e) => ({ ...e, id: eid(e.id), metricId: nid(e.metricId) })),
    microwins: incoming.microwins
      .filter((m) => known.has(m.metricId))
      .map((m) => ({ ...m, id: wid(m.id), metricId: nid(m.metricId) })),
  };
}

/** Jeden otisk na projekt a den - při slučování musí zůstat jen jeden. */
function dedupeSnapshots(snapshots: Snapshot[]): Snapshot[] {
  const map = new Map<string, Snapshot>();
  for (const s of snapshots) map.set(`${s.projectId}|${s.date}`, s);
  return [...map.values()];
}

/** Totéž pro otisky úkolů. */
function dedupeTaskSnapshots(snapshots: TaskSnapshot[]): TaskSnapshot[] {
  const map = new Map<string, TaskSnapshot>();
  for (const s of snapshots) map.set(`${s.taskId}|${s.date}`, s);
  return [...map.values()];
}

/**
 * Listy time boxu při přidávání. Na rozdíl od otisků tady vyhrává **to, co už
 * v appce je**: otisk je spočítaný údaj, ale priority a brain dump někdo psal
 * rukou a přidaná záloha mu je nemá přepsat.
 */
function mergeSheets(current: DaySheet[], incoming: DaySheet[]): DaySheet[] {
  const taken = new Set(current.map((s) => s.date));
  return [...current, ...incoming.filter((s) => !taken.has(s.date))].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/**
 * Odkaz bloku na věc, která v souboru možná vůbec není.
 *
 * Přišla-li ta věc se zálohou, ukazuje odkaz na její (případně nové) id. Když
 * ne, drží se jen tehdy, když stejné id v appce opravdu je - id jsou náhodná,
 * takže shoda znamená tutéž věc (blok uložený a načtený na stejném telefonu).
 * Jinak se utrhne: blok zůstane s popiskem, jen nikam nevede. Utržený odkaz
 * je menší škoda než díra v naplánovaném dni.
 */
function relink(
  id: string | null,
  imported: Map<string, string> | null,
  exists: (id: string) => boolean,
): string | null {
  if (!id) return null;
  const candidate = imported?.get(id) ?? id;
  return exists(candidate) ? candidate : null;
}

/**
 * Sloučí zálohu se současným stavem podle vybraných částí a režimu.
 * Nedotčené kolekce se vrací beze změny, včetně identity polí.
 *
 * `what` jsou buď části (`["todo", "plan"]`), nebo starší zkratka rozsahu.
 */
export function mergeState(
  current: MicroWinsState,
  incoming: MicroWinsState,
  what: ImportScope | readonly DataPart[],
  mode: ImportMode,
): MicroWinsState {
  const parts = new Set<DataPart>(typeof what === "string" ? scopeParts(what) : what);
  const fresh = mode === "add";
  const takeBlocks = parts.has("plan") || parts.has("timebox");

  let next: MicroWinsState = { ...current, version: current.version };

  if (parts.has("tree")) {
    const part = treePart(incoming, fresh);
    next = fresh
      ? {
          ...next,
          nodes: [...next.nodes, ...part.nodes],
          entries: [...next.entries, ...part.entries],
          microwins: [...next.microwins, ...part.microwins],
        }
      : { ...next, ...part };
  }

  /* Mapy starých id na nová. Bloky plánu se skládají až nakonec a odkazy
     přerážejí podle nich - `null` znamená, že ta část se nenačítala. */
  let taskIds: Map<string, string> | null = null;
  let todoIds: Map<string, string> | null = null;

  if (parts.has("projects")) {
    const offset = fresh ? next.projects.length : 0;
    const { part, taskIds: ids } = projectPart(incoming, fresh, offset);
    taskIds = ids;
    next = fresh
      ? {
          ...next,
          projects: [...next.projects, ...part.projects],
          tasks: [...next.tasks, ...part.tasks],
          milestones: [...next.milestones, ...part.milestones],
          snapshots: dedupeSnapshots([...next.snapshots, ...part.snapshots]),
          taskSnapshots: dedupeTaskSnapshots([...next.taskSnapshots, ...part.taskSnapshots]),
        }
      : {
          ...next,
          ...part,
          snapshots: dedupeSnapshots(part.snapshots),
          taskSnapshots: dedupeTaskSnapshots(part.taskSnapshots),
        };
  }

  if (parts.has("todo")) {
    todoIds = new Map(incoming.todos.map((t) => [t.id, fresh ? createId("imp") : t.id] as const));
    // ToDo na nic neodkazuje, takže se jen přerazí id a pořadí posadí za
    // stávající položky - jinak by se dva seznamy prolnuly.
    const todoOffset = fresh ? next.todos.reduce((max, t) => Math.max(max, t.order + 1), 0) : 0;
    // Stejně jako u projektů: ruční pořadí žije v `order`, ne v pozici v poli.
    const rank = rankByOrder(incoming.todos);
    const ids = todoIds;
    const todos: Todo[] = incoming.todos.map((t) => ({
      ...t,
      id: ids.get(t.id) ?? t.id,
      order: todoOffset + (rank.get(t.id) ?? 0),
    }));
    next = { ...next, todos: fresh ? [...next.todos, ...todos] : todos };
  }

  /* Listy time boxu na nic neodkazují - drží je datum, ne id. Přerážet se tedy
     nemá co a den z jiné zálohy zůstává tím samým dnem. */
  if (parts.has("timebox")) {
    next = {
      ...next,
      daySheets: fresh ? mergeSheets(next.daySheets, incoming.daySheets) : incoming.daySheets,
    };
  }

  if (takeBlocks) {
    const merged = next;
    const tasks = new Set(merged.tasks.map((t) => t.id));
    const todos = new Set(merged.todos.map((t) => t.id));

    const blocks: TimeBlock[] = incoming.timeBlocks.map((b) => ({
      ...b,
      id: fresh ? createId("imp") : b.id,
      todoId: relink(b.todoId, todoIds, (id) => todos.has(id)),
      taskId: relink(b.taskId, taskIds, (id) => tasks.has(id)),
      /* Odkaz na hlavní věc dne je den a pořadí. Blok si z ní bere text, takže
         kdyby v ten den v appce stál jiný list než v záloze (při přidávání
         vyhrává ten, co už tu je), ukazoval by blok cizí prioritu. Drží se
         proto, jen když po načtení na tom místě stojí totéž co v záloze. */
      priorityId:
        b.priorityId && priorityText(merged, b.priorityId) === priorityText(incoming, b.priorityId)
          ? b.priorityId
          : null,
    }));
    next = { ...next, timeBlocks: fresh ? [...next.timeBlocks, ...blocks] : blocks };
  }

  return next;
}

/**
 * Přiroubuje mapy atomů ze souboru pod projekt, který už v appce je.
 *
 * `rootIds` jsou vybrané úkoly nejvyšší úrovně ze souboru; každý s sebou
 * vezme celý svůj podstrom i historii postupu. Id se přerážejí vždycky -
 * mapa se dá načíst dvakrát a dvě kopie se nesmějí potkat. Nové kořeny se
 * řadí za stávající úkoly projektu, ve svém původním pořadí.
 *
 * Milníky ani vazby na ně se nepřenášejí: patří projektu, odkud mapa přišla.
 */
export function graftTaskTrees(
  current: MicroWinsState,
  incoming: MicroWinsState,
  rootIds: readonly string[],
  projectId: string,
  today: ISODate,
): { state: MicroWinsState; rootIds: string[] } {
  if (!current.projects.some((p) => p.id === projectId)) return { state: current, rootIds: [] };

  const byParent = new Map<string | null, Task[]>();
  for (const t of incoming.tasks) {
    const list = byParent.get(t.parentId) ?? [];
    list.push(t);
    byParent.set(t.parentId, list);
  }

  // Kořen + celý podstrom; `seen` hlídá zacyklená data z cizího souboru.
  const picked: Task[] = [];
  const seen = new Set<string>();
  const walk = (task: Task) => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    picked.push(task);
    for (const child of byParent.get(task.id) ?? []) walk(child);
  };
  const roots = incoming.tasks.filter((t) => rootIds.includes(t.id));
  roots.forEach(walk);
  if (picked.length === 0) return { state: current, rootIds: [] };

  const ids = remap(picked.map((t) => t.id));
  const rootRank = rankByOrder(roots);
  const offset = current.tasks
    .filter((t) => t.projectId === projectId && t.parentId === null)
    .reduce((max, t) => Math.max(max, t.order + 1), 0);

  const tasks: Task[] = picked.map((t) => {
    const rank = rootRank.get(t.id);
    return {
      ...t,
      id: ids.get(t.id) as string,
      projectId,
      parentId: rank === undefined && t.parentId ? (ids.get(t.parentId) ?? null) : null,
      milestoneId: null,
      order: rank === undefined ? t.order : offset + rank,
    };
  });

  const taskSnapshots = incoming.taskSnapshots
    .filter((s) => ids.has(s.taskId))
    .map((s) => ({ ...s, taskId: ids.get(s.taskId) as string }));

  const grafted: MicroWinsState = {
    ...current,
    tasks: [...current.tasks, ...tasks],
    taskSnapshots: dedupeTaskSnapshots([...current.taskSnapshots, ...taskSnapshots]),
  };

  return {
    // Procenta projektu se tím pohnula - dnešní otisk to musí vědět.
    state: snapshotProject(grafted, projectId, today),
    rootIds: roots.map((r) => ids.get(r.id) as string),
  };
}
