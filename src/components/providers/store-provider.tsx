"use client";

import * as React from "react";
import * as actions from "@/lib/actions";
import * as projectActions from "@/lib/project-actions";
import { applySettings, exportBackup, parseBackup, type ExportOutcome } from "@/lib/backup";
import { todayISO } from "@/lib/date";
import { loadState, saveState } from "@/lib/storage";
import {
  EMPTY_STATE,
  type ISODate,
  type MicroWinsState,
  type Milestone,
  type Project,
  type Task,
  type TreeNode,
} from "@/lib/types";

export interface StoreApi {
  state: MicroWinsState;
  /** Aktuální den uživatele - obnovuje se po půlnoci i po návratu do okna. */
  today: ISODate;
  hydrated: boolean;
  addCategory: (parentId: string | null, name: string) => TreeNode;
  addMetric: (parentId: string | null, input: actions.MetricInput) => TreeNode;
  addCheck: (parentId: string | null, name: string) => TreeNode;
  addOnce: (parentId: string | null, input: actions.OnceInput) => actions.AddOnceResult;
  updateNode: (
    id: string,
    patch: Partial<Pick<TreeNode, "name" | "unit" | "aggregation">>,
  ) => void;
  updateOnce: (id: string, patch: actions.OncePatch) => void;
  deleteNode: (id: string) => void;
  addEntry: (input: actions.AddEntryInput) => actions.AddEntryResult;
  toggleCheck: (id: string, date?: ISODate) => actions.ToggleCheckResult;
  deleteEntry: (id: string) => void;

  createProject: (input: projectActions.ProjectInput) => Project;
  updateProject: (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => void;
  deleteProject: (id: string) => void;
  setProjectArchived: (id: string, archived: boolean) => void;
  moveProject: (id: string, direction: -1 | 1) => void;

  createTask: (projectId: string, input: projectActions.TaskInput) => Task;
  updateTask: (id: string, patch: Partial<Omit<Task, "id" | "projectId" | "createdAt">>) => void;
  setTaskCurrent: (id: string, value: number) => void;
  adjustTask: (id: string, delta: number) => void;
  toggleTaskDone: (id: string) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, direction: -1 | 1) => void;

  createMilestone: (projectId: string, name: string, date: ISODate | null) => Milestone;
  deleteMilestone: (id: string) => void;

  reset: () => void;
  /** Načte zálohu (nový formát i starší holý export). */
  importJson: (text: string) => boolean;
  /** Vyexportuje celou zálohu - sdílením v appce, stažením v prohlížeči. */
  exportJson: () => Promise<ExportOutcome>;
}

const StoreContext = React.createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStore musí být uvnitř StoreProvider");
  return ctx;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<MicroWinsState>(EMPTY_STATE);
  const [hydrated, setHydrated] = React.useState(false);
  const [today, setToday] = React.useState<ISODate>(() => todayISO());

  // Nejnovější stav i mimo render - akce potřebují číst synchronně.
  const ref = React.useRef(state);
  const commit = React.useCallback((next: MicroWinsState) => {
    ref.current = next;
    setState(next);
  }, []);

  React.useEffect(() => {
    const loaded = loadState();
    ref.current = loaded;
    setState(loaded);
    setToday(todayISO());
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  // Přechod přes půlnoc: co bylo "dnes", je najednou včerejšek.
  React.useEffect(() => {
    const tick = () => setToday(todayISO());
    const id = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const api = React.useMemo<StoreApi>(
    () => ({
      state,
      today,
      hydrated,
      addCategory: (parentId, name) => {
        const res = actions.addCategory(ref.current, parentId, name);
        commit(res.state);
        return res.node;
      },
      addMetric: (parentId, input) => {
        const res = actions.addMetric(ref.current, parentId, input);
        commit(res.state);
        return res.node;
      },
      addCheck: (parentId, name) => {
        const res = actions.addCheck(ref.current, parentId, name);
        commit(res.state);
        return res.node;
      },
      addOnce: (parentId, input) => {
        const res = actions.addOnce(ref.current, parentId, input, todayISO());
        commit(res.state);
        return res;
      },
      updateNode: (id, patch) => commit(actions.updateNode(ref.current, id, patch, todayISO())),
      updateOnce: (id, patch) => commit(actions.updateOnce(ref.current, id, patch, todayISO())),
      deleteNode: (id) => commit(actions.deleteNode(ref.current, id)),
      addEntry: (input) => {
        const res = actions.addEntry(ref.current, input, todayISO());
        if (res.state !== ref.current) commit(res.state);
        return res;
      },
      toggleCheck: (id, date) => {
        const res = actions.toggleCheck(ref.current, id, date, todayISO());
        if (res.state !== ref.current) commit(res.state);
        return res;
      },
      deleteEntry: (id) => commit(actions.deleteEntry(ref.current, id, todayISO())),

      createProject: (input) => {
        const res = projectActions.createProject(ref.current, input, todayISO());
        commit(res.state);
        return res.project;
      },
      updateProject: (id, patch) => commit(projectActions.updateProject(ref.current, id, patch)),
      deleteProject: (id) => commit(projectActions.deleteProject(ref.current, id)),
      setProjectArchived: (id, archived) =>
        commit(projectActions.setProjectArchived(ref.current, id, archived)),
      moveProject: (id, direction) => commit(projectActions.moveProject(ref.current, id, direction)),

      createTask: (projectId, input) => {
        const res = projectActions.createTask(ref.current, projectId, input, todayISO());
        commit(res.state);
        return res.task;
      },
      updateTask: (id, patch) =>
        commit(projectActions.updateTask(ref.current, id, patch, todayISO())),
      setTaskCurrent: (id, value) =>
        commit(projectActions.setTaskCurrent(ref.current, id, value, todayISO())),
      adjustTask: (id, delta) =>
        commit(projectActions.adjustTask(ref.current, id, delta, todayISO())),
      toggleTaskDone: (id) => commit(projectActions.toggleTaskDone(ref.current, id, todayISO())),
      deleteTask: (id) => commit(projectActions.deleteTask(ref.current, id, todayISO())),
      moveTask: (id, direction) => commit(projectActions.moveTask(ref.current, id, direction)),

      createMilestone: (projectId, name, date) => {
        const res = projectActions.createMilestone(ref.current, projectId, name, date);
        commit(res.state);
        return res.milestone;
      },
      deleteMilestone: (id) => commit(projectActions.deleteMilestone(ref.current, id)),

      reset: () => commit(EMPTY_STATE),
      importJson: (text) => {
        const parsed = parseBackup(text);
        if (!parsed) return false;
        commit(parsed.state);
        applySettings(parsed.settings);
        return true;
      },
      exportJson: () => exportBackup(ref.current),
    }),
    [state, today, hydrated, commit],
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
