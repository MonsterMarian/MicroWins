import { addDays, todayISO } from "./date";
import {
  allTasksOfProject,
  clampPercent,
  isTaskDone,
  projectPercent,
  roundPercent,
  subtasksOf,
  taskById,
  taskPercent,
  tasksOfProject,
  weightOf,
} from "./projects";
import type { ISODate, MicroWinsState, Milestone, Project, Task, TaskSnapshot } from "./types";
import { createId } from "./utils";

/** CRUD nad projekty a úkoly. Každá změna hodnoty rovnou zapíše denní otisk. */

export interface ProjectInput {
  name: string;
  icon?: string;
  startDate?: ISODate;
  deadline?: ISODate | null;
  description?: string;
}

export function createProject(
  state: MicroWinsState,
  input: ProjectInput,
  today: ISODate = todayISO(),
): { state: MicroWinsState; project: Project } {
  const project: Project = {
    id: createId("prj"),
    name: input.name.trim(),
    icon: input.icon?.trim() || "📁",
    startDate: input.startDate ?? today,
    deadline: input.deadline ?? null,
    description: input.description ?? "",
    order: state.projects.length,
    createdAt: new Date().toISOString(),
    archivedAt: null,
  };
  const next: MicroWinsState = {
    ...state,
    projects: [...state.projects, project],
    snapshots: [...state.snapshots, { projectId: project.id, date: project.startDate, percent: 0 }],
  };
  return { state: next, project };
}

export function updateProject(
  state: MicroWinsState,
  id: string,
  patch: Partial<Omit<Project, "id" | "createdAt">>,
): MicroWinsState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

export function deleteProject(state: MicroWinsState, id: string): MicroWinsState {
  const taskIds = new Set(state.tasks.filter((t) => t.projectId === id).map((t) => t.id));
  return {
    ...state,
    projects: state.projects.filter((p) => p.id !== id),
    tasks: state.tasks.filter((t) => t.projectId !== id),
    milestones: state.milestones.filter((m) => m.projectId !== id),
    snapshots: state.snapshots.filter((s) => s.projectId !== id),
    taskSnapshots: state.taskSnapshots.filter((s) => !taskIds.has(s.taskId)),
  };
}

export function setProjectArchived(
  state: MicroWinsState,
  id: string,
  archived: boolean,
): MicroWinsState {
  return updateProject(state, id, { archivedAt: archived ? new Date().toISOString() : null });
}

/**
 * Přeskládá pořadí podle seznamu id.
 *
 * Seznam nese jen tu část, kterou uživatel vidí - filtr, hledání nebo jiný
 * rodič zbytek schovají. Skryté položky proto zůstávají na svých místech
 * a přetažené se rozdají do pozic, které předtím zabíral viditelný výběr.
 */
function applyOrder<T extends { id: string; order: number }>(ordered: T[], ids: string[]): T[] {
  const wanted = ids
    .map((id) => ordered.find((item) => item.id === id))
    .filter((item): item is T => item !== undefined);
  if (wanted.length === 0) return ordered;

  const slots = ordered.reduce<number[]>((acc, item, index) => {
    if (wanted.some((w) => w.id === item.id)) acc.push(index);
    return acc;
  }, []);
  const next = [...ordered];
  slots.forEach((slot, i) => {
    next[slot] = wanted[i];
  });
  return next.map((item, index) => (item.order === index ? item : { ...item, order: index }));
}

/** Nové pořadí projektů po přetažení - `ids` jsou viditelné řádky shora dolů. */
export function reorderProjects(state: MicroWinsState, ids: string[]): MicroWinsState {
  const ordered = [...state.projects].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  );
  const byId = new Map(applyOrder(ordered, ids).map((p) => [p.id, p]));
  return { ...state, projects: state.projects.map((p) => byId.get(p.id) ?? p) };
}

/**
 * Nové pořadí úkolů po přetažení. Skupina se odvodí z prvního známého id -
 * přetahovat jde vždy jen mezi sourozenci, takže rodič je pro celý seznam
 * stejný a nedá se jím úkol přesunout jinam.
 */
export function reorderTasks(state: MicroWinsState, ids: string[]): MicroWinsState {
  const first = ids.map((id) => taskById(state, id)).find((t): t is Task => t !== undefined);
  if (!first) return state;

  const siblings =
    first.parentId === null
      ? tasksOfProject(state, first.projectId)
      : subtasksOf(state, first.parentId);
  const inGroup = ids.filter((id) => siblings.some((s) => s.id === id));
  const byId = new Map(applyOrder(siblings, inGroup).map((t) => [t.id, t]));
  return { ...state, tasks: state.tasks.map((t) => byId.get(t.id) ?? t) };
}

/** Přesun projektu v ručním pořadí (drag/šipky). */
export function moveProject(state: MicroWinsState, id: string, direction: -1 | 1): MicroWinsState {
  const ordered = [...state.projects].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((p) => p.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return state;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const orderById = new Map(ordered.map((p, i) => [p.id, i]));
  return {
    ...state,
    projects: state.projects.map((p) => ({ ...p, order: orderById.get(p.id) ?? p.order })),
  };
}

// --- otisky -----------------------------------------------------------------

/** Zapíše (nebo přepíše) dnešní otisk postupu projektu i jeho úkolů. */
export function snapshotProject(
  state: MicroWinsState,
  projectId: string,
  today: ISODate = todayISO(),
): MicroWinsState {
  const percent = projectPercent(state, projectId);
  const rest = state.snapshots.filter((s) => !(s.projectId === projectId && s.date === today));
  const withProject: MicroWinsState = {
    ...state,
    snapshots: [...rest, { projectId, date: today, percent }],
  };
  return { ...withProject, taskSnapshots: snapshotTasks(withProject, projectId, today) };
}

/**
 * Denní otisky jednotlivých úkolů. Zapisují se stejně jako u projektu -
 * hodnota na konci dne - ale jen tam, kde se opravdu něco hnulo. Nedotčený
 * úkol tak nezakládá řádek za den; dvacet úkolů by za rok nadělalo sedm tisíc
 * záznamů, které by nikdo nikdy nepřečetl.
 */
function snapshotTasks(
  state: MicroWinsState,
  projectId: string,
  today: ISODate,
): TaskSnapshot[] {
  const tasks = allTasksOfProject(state, projectId);
  const ids = new Set(tasks.map((t) => t.id));
  // Dnešní řádky vlastních úkolů se skládají znovu; cizí zůstávají.
  const kept = state.taskSnapshots.filter((s) => !(ids.has(s.taskId) && s.date === today));
  const fresh: TaskSnapshot[] = [];

  for (const task of tasks) {
    const percent = roundPercent(taskPercent(state, task));
    const before = lastTaskSnapshot(kept, task.id, today);
    // Beze změny proti poslednímu známému dni není co zapisovat. Úkol bez
    // historie svůj první řádek dostane vždy - je to základ pro příští přírůstek.
    if (before && Math.abs(before.percent - percent) < 0.05) continue;
    fresh.push({ taskId: task.id, date: today, percent });
  }

  return [...kept, ...fresh];
}

/** Poslední otisk úkolu ke dni `date` (včetně). */
function lastTaskSnapshot(
  snapshots: TaskSnapshot[],
  taskId: string,
  date: ISODate,
): TaskSnapshot | undefined {
  let best: TaskSnapshot | undefined;
  for (const s of snapshots) {
    if (s.taskId !== taskId || s.date > date) continue;
    if (!best || s.date > best.date) best = s;
  }
  return best;
}

// --- úkoly ------------------------------------------------------------------

/**
 * Úkoly počítají v celých číslech: půlka kliku ani 0,3 přečtené stránky
 * nedávají smysl a v seznamu z toho vznikaly nečitelné hodnoty typu
 * "13,6 / 20". Desetinné číslo se proto zaokrouhlí hned při zápisu.
 *
 * `min` je spodní mez (u cíle, kroku i váhy 1, u hotové hodnoty 0).
 */
function whole(value: number | undefined, min: number, fallback = min): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

export interface TaskInput {
  name: string;
  target?: number;
  current?: number;
  unit?: string;
  step?: number;
  weight?: number;
  icon?: string;
  dueDate?: ISODate | null;
  milestoneId?: string | null;
  description?: string;
  parentId?: string | null;
}

export function createTask(
  state: MicroWinsState,
  projectId: string,
  input: TaskInput,
  today: ISODate = todayISO(),
): { state: MicroWinsState; task: Task } {
  const siblings = state.tasks.filter(
    (t) => t.projectId === projectId && t.parentId === (input.parentId ?? null),
  );
  const target = whole(input.target, 1);
  const current = Math.min(Math.max(whole(input.current, 0, 0), 0), target);
  const task: Task = {
    id: createId("tsk"),
    projectId,
    parentId: input.parentId ?? null,
    name: input.name.trim(),
    icon: input.icon?.trim() || "📝",
    target,
    current,
    unit: input.unit?.trim() || undefined,
    step: whole(input.step, 1),
    weight: whole(input.weight, 0, 1),
    dueDate: input.dueDate ?? null,
    milestoneId: input.milestoneId ?? null,
    description: input.description ?? "",
    order: siblings.length,
    createdAt: new Date().toISOString(),
    completedAt: current >= target ? new Date().toISOString() : null,
  };
  const withTask: MicroWinsState = { ...state, tasks: [...state.tasks, task] };
  return { state: snapshotProject(withTask, projectId, today), task };
}

export function updateTask(
  state: MicroWinsState,
  id: string,
  patch: Partial<Omit<Task, "id" | "projectId" | "createdAt">>,
  today: ISODate = todayISO(),
): MicroWinsState {
  const task = taskById(state, id);
  if (!task) return state;

  // Backfill a baseline snapshot for legacy tasks that have no history before today.
  // Without this, the first modification of a legacy task would wipe its history baseline,
  // causing taskDeltaToday to report 0%.
  const hasHistory = state.taskSnapshots.some((s) => s.taskId === id && s.date < today);
  if (!hasHistory && task.createdAt.slice(0, 10) < today) {
    const oldPercent = roundPercent(taskPercent(state, task));
    state = {
      ...state,
      taskSnapshots: [
        ...state.taskSnapshots,
        { taskId: id, date: addDays(today, -1), percent: oldPercent },
      ],
    };
  }

  const merged: Task = { ...task, ...patch };
  merged.target = whole(merged.target, 1);
  merged.current = Math.min(Math.max(whole(merged.current, 0, 0), 0), merged.target);
  merged.step = whole(merged.step, 1);
  // Váha smí být 0 - takový úkol se do průměru nepočítá.
  merged.weight = whole(merged.weight, 0, 1);

  const next: MicroWinsState = {
    ...state,
    tasks: state.tasks.map((t) => (t.id === id ? merged : t)),
  };
  const done = isTaskDone(next, merged);
  const withCompletion: MicroWinsState = {
    ...next,
    tasks: next.tasks.map((t) =>
      t.id === id
        ? {
            ...t,
            completedAt: done ? (t.completedAt ?? new Date().toISOString()) : null,
          }
        : t,
    ),
  };
  return snapshotProject(withCompletion, task.projectId, today);
}

/** Nastaví absolutní hodnotu (slider, přímý zápis). */
export function setTaskCurrent(
  state: MicroWinsState,
  id: string,
  value: number,
  today: ISODate = todayISO(),
): MicroWinsState {
  if (!Number.isFinite(value)) return state;
  return updateTask(state, id, { current: value }, today);
}

/** Posune hodnotu o krok (tlačítka +/-). */
export function adjustTask(
  state: MicroWinsState,
  id: string,
  delta: number,
  today: ISODate = todayISO(),
): MicroWinsState {
  const task = taskById(state, id);
  if (!task) return state;
  return setTaskCurrent(state, id, task.current + delta, today);
}

/** Přepínač hotovo/nehotovo - nastaví hodnotu na cíl nebo na nulu. */
export function toggleTaskDone(
  state: MicroWinsState,
  id: string,
  today: ISODate = todayISO(),
): MicroWinsState {
  const task = taskById(state, id);
  if (!task) return state;
  const done = isTaskDone(state, task);
  return setTaskCurrent(state, id, done ? 0 : task.target, today);
}

export function deleteTask(
  state: MicroWinsState,
  id: string,
  today: ISODate = todayISO(),
): MicroWinsState {
  const task = taskById(state, id);
  if (!task) return state;
  const ids = new Set<string>([id]);
  for (const child of subtasksOf(state, id)) ids.add(child.id);
  const next: MicroWinsState = {
    ...state,
    tasks: state.tasks.filter((t) => !ids.has(t.id)),
    taskSnapshots: state.taskSnapshots.filter((s) => !ids.has(s.taskId)),
  };
  return snapshotProject(next, task.projectId, today);
}

export function moveTask(
  state: MicroWinsState,
  id: string,
  direction: -1 | 1,
): MicroWinsState {
  const task = taskById(state, id);
  if (!task) return state;
  const siblings =
    task.parentId === null
      ? tasksOfProject(state, task.projectId)
      : subtasksOf(state, task.parentId);
  const index = siblings.findIndex((t) => t.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= siblings.length) return state;
  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const orderById = new Map(reordered.map((t, i) => [t.id, i]));
  return {
    ...state,
    tasks: state.tasks.map((t) => (orderById.has(t.id) ? { ...t, order: orderById.get(t.id)! } : t)),
  };
}

// --- milníky ----------------------------------------------------------------

export function createMilestone(
  state: MicroWinsState,
  projectId: string,
  name: string,
  date: ISODate | null,
): { state: MicroWinsState; milestone: Milestone } {
  const milestone: Milestone = {
    id: createId("mst"),
    projectId,
    name: name.trim(),
    date,
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
  return { state: { ...state, milestones: [...state.milestones, milestone] }, milestone };
}

/**
 * Odškrtnutí milníku. Schválně nesahá na úkoly ani na otisky - milník je
 * poznámka na ose, ne kus práce. Kdyby hýbal procenty, počítala by se stejná
 * práce dvakrát: jednou v úkolu, podruhé v milníku, který ten úkol shrnuje.
 */
export function toggleMilestoneDone(state: MicroWinsState, id: string): MicroWinsState {
  return {
    ...state,
    milestones: state.milestones.map((m) =>
      m.id === id ? { ...m, doneAt: m.doneAt ? null : new Date().toISOString() } : m,
    ),
  };
}

export function updateMilestone(
  state: MicroWinsState,
  id: string,
  patch: Partial<Pick<Milestone, "name" | "date">>,
): MicroWinsState {
  return {
    ...state,
    milestones: state.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  };
}

export function deleteMilestone(state: MicroWinsState, id: string): MicroWinsState {
  return {
    ...state,
    milestones: state.milestones.filter((m) => m.id !== id),
    tasks: state.tasks.map((t) => (t.milestoneId === id ? { ...t, milestoneId: null } : t)),
  };
}

/**
 * Postup milníku = vážený průměr jeho úkolů. Jen informativní číslo do výpisu -
 * procenta projektu z něj nevycházejí, milník se odškrtává ručně.
 */
export function milestonePercent(state: MicroWinsState, milestoneId: string): number {
  const tasks = state.tasks.filter((t) => t.milestoneId === milestoneId);
  if (tasks.length === 0) return 0;
  const totalWeight = tasks.reduce((s, t) => s + weightOf(t), 0);
  if (totalWeight === 0) return 0;
  const sum = tasks.reduce(
    (s, t) => s + (t.target > 0 ? Math.min(100, (t.current / t.target) * 100) : 0) * weightOf(t),
    0,
  );
  return clampPercent(sum / totalWeight);
}
