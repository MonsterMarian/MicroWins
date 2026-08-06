import { todayISO } from "./date";
import {
  clampPercent,
  isTaskDone,
  projectPercent,
  subtasksOf,
  taskById,
  tasksOfProject,
} from "./projects";
import type { ISODate, MicroWinsState, Milestone, Project, Task } from "./types";
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
  return {
    ...state,
    projects: state.projects.filter((p) => p.id !== id),
    tasks: state.tasks.filter((t) => t.projectId !== id),
    milestones: state.milestones.filter((m) => m.projectId !== id),
    snapshots: state.snapshots.filter((s) => s.projectId !== id),
  };
}

export function setProjectArchived(
  state: MicroWinsState,
  id: string,
  archived: boolean,
): MicroWinsState {
  return updateProject(state, id, { archivedAt: archived ? new Date().toISOString() : null });
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

/** Zapíše (nebo přepíše) dnešní otisk postupu projektu. */
export function snapshotProject(
  state: MicroWinsState,
  projectId: string,
  today: ISODate = todayISO(),
): MicroWinsState {
  const percent = projectPercent(state, projectId);
  const rest = state.snapshots.filter((s) => !(s.projectId === projectId && s.date === today));
  return { ...state, snapshots: [...rest, { projectId, date: today, percent }] };
}

// --- úkoly ------------------------------------------------------------------

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
  const target = input.target && input.target > 0 ? input.target : 1;
  const current = Math.min(Math.max(input.current ?? 0, 0), target);
  const task: Task = {
    id: createId("tsk"),
    projectId,
    parentId: input.parentId ?? null,
    name: input.name.trim(),
    icon: input.icon?.trim() || "📝",
    target,
    current,
    unit: input.unit?.trim() || undefined,
    step: input.step && input.step > 0 ? input.step : 1,
    weight: input.weight && input.weight > 0 ? input.weight : 1,
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

  const merged: Task = { ...task, ...patch };
  merged.target = merged.target > 0 ? merged.target : 1;
  merged.current = Math.min(Math.max(merged.current, 0), merged.target);
  merged.step = merged.step > 0 ? merged.step : 1;
  merged.weight = merged.weight > 0 ? merged.weight : 1;

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
  const next: MicroWinsState = { ...state, tasks: state.tasks.filter((t) => !ids.has(t.id)) };
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
  };
  return { state: { ...state, milestones: [...state.milestones, milestone] }, milestone };
}

export function deleteMilestone(state: MicroWinsState, id: string): MicroWinsState {
  return {
    ...state,
    milestones: state.milestones.filter((m) => m.id !== id),
    tasks: state.tasks.map((t) => (t.milestoneId === id ? { ...t, milestoneId: null } : t)),
  };
}

/** Postup milníku = vážený průměr jeho úkolů. */
export function milestonePercent(state: MicroWinsState, milestoneId: string): number {
  const tasks = state.tasks.filter((t) => t.milestoneId === milestoneId);
  if (tasks.length === 0) return 0;
  const totalWeight = tasks.reduce((s, t) => s + (t.weight || 1), 0);
  const sum = tasks.reduce(
    (s, t) => s + (t.target > 0 ? Math.min(100, (t.current / t.target) * 100) : 0) * (t.weight || 1),
    0,
  );
  return clampPercent(sum / totalWeight);
}
