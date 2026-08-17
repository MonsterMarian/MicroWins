import type { MicroWinsState, Project, Snapshot, Task, TaskSnapshot, Todo, TreeNode } from "./types";
import { createId } from "./utils";

/**
 * Načtení zálohy po částech.
 *
 * Appka drží dvě nezávislé poloviny - strom winů a projekty. Když si člověk
 * tahá projekty z jiné aplikace, nesmí tím smazat strom, který si tady vede
 * měsíce. Proto se dá vybrat, co se z zálohy vezme (`ImportScope`) a jestli
 * se to k existujícím datům přidá, nebo je nahradí (`ImportMode`).
 *
 * Čisté funkce, žádné localStorage - merge je otestovaný bez renderu.
 */

/** Kterou polovinu dat ze zálohy vzít. */
export type ImportScope = "all" | "projects" | "tree";

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
  };
}

/** Záloha nese aspoň jednu z polovin - jinak není co načítat. */
export function hasScope(counts: StateCounts, scope: ImportScope): boolean {
  const tree = counts.folders + counts.wins > 0;
  // ToDo patří k projektové polovině: záloha se samotným seznamem je pořád
  // něco, co má smysl načíst.
  const projects = counts.projects + counts.todos > 0;
  if (scope === "tree") return tree;
  if (scope === "projects") return projects;
  return tree || projects;
}

/** Nová id pro celou příchozí sadu - `add` nesmí navázat na stávající data. */
function remap(ids: string[]): Map<string, string> {
  return new Map(ids.map((id) => [id, createId("imp")]));
}

/**
 * Projekty, úkoly, milníky a otisky z příchozího stavu, případně s novými id.
 * Úkol nebo milník bez svého projektu se zahodí - jinak by v appce zůstal
 * neviditelný záznam, na který se nedá dostat.
 */
function projectPart(
  incoming: MicroWinsState,
  fresh: boolean,
  orderOffset: number,
): Pick<MicroWinsState, "projects" | "tasks" | "milestones" | "snapshots" | "taskSnapshots"> {
  const projectIds = remap(incoming.projects.map((p) => p.id));
  const taskIds = remap(incoming.tasks.map((t) => t.id));
  const milestoneIds = remap(incoming.milestones.map((m) => m.id));

  const pid = (id: string) => (fresh ? (projectIds.get(id) ?? id) : id);
  const tid = (id: string) => (fresh ? (taskIds.get(id) ?? id) : id);
  const mid = (id: string) => (fresh ? (milestoneIds.get(id) ?? id) : id);

  const known = new Set(incoming.projects.map((p) => p.id));
  const knownTasks = new Set(incoming.tasks.map((t) => t.id));
  const knownMilestones = new Set(incoming.milestones.map((m) => m.id));

  const projects: Project[] = incoming.projects.map((p, i) => ({
    ...p,
    id: pid(p.id),
    order: orderOffset + i,
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

  return { projects, tasks, milestones, snapshots, taskSnapshots };
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
 * Sloučí zálohu se současným stavem podle rozsahu a režimu. Nedotčená
 * polovina se vrací beze změny, včetně identity polí.
 */
export function mergeState(
  current: MicroWinsState,
  incoming: MicroWinsState,
  scope: ImportScope,
  mode: ImportMode,
): MicroWinsState {
  const takeTree = scope === "all" || scope === "tree";
  const takeProjects = scope === "all" || scope === "projects";
  const fresh = mode === "add";

  let next: MicroWinsState = { ...current, version: current.version };

  if (takeTree) {
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

  if (takeProjects) {
    const offset = fresh ? next.projects.length : 0;
    const part = projectPart(incoming, fresh, offset);
    // ToDo na nic neodkazuje, takže se jen přerazí id a pořadí posadí za
    // stávající položky - jinak by se dva seznamy prolnuly.
    const todoOffset = fresh
      ? next.todos.reduce((max, t) => Math.max(max, t.order + 1), 0)
      : 0;
    const todos: Todo[] = incoming.todos.map((t, i) => ({
      ...t,
      id: fresh ? createId("imp") : t.id,
      order: todoOffset + i,
    }));
    next = fresh
      ? {
          ...next,
          projects: [...next.projects, ...part.projects],
          tasks: [...next.tasks, ...part.tasks],
          milestones: [...next.milestones, ...part.milestones],
          snapshots: dedupeSnapshots([...next.snapshots, ...part.snapshots]),
          taskSnapshots: dedupeTaskSnapshots([...next.taskSnapshots, ...part.taskSnapshots]),
          todos: [...next.todos, ...todos],
        }
      : {
          ...next,
          projects: part.projects,
          tasks: part.tasks,
          milestones: part.milestones,
          snapshots: dedupeSnapshots(part.snapshots),
          taskSnapshots: dedupeTaskSnapshots(part.taskSnapshots),
          todos,
        };
  }

  return next;
}
