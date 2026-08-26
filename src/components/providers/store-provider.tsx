"use client";

import * as React from "react";
import * as actions from "@/lib/actions";
import * as projectActions from "@/lib/project-actions";
import {
  applySettings,
  exportBackup,
  parseBackup,
  type ExportOutcome,
  type ExportTarget,
} from "@/lib/backup";
import { todayISO } from "@/lib/date";
import { applyDevSeed } from "@/lib/dev-seed";
import { mergeState, type ImportMode, type ImportScope } from "@/lib/import";
import { todoTtlMs } from "@/lib/prefs";
import { loadState, saveState } from "@/lib/storage";
import * as blockActions from "@/lib/timeblocks";
import * as todoActions from "@/lib/todos";
import {
  EMPTY_STATE,
  type ISODate,
  type MicroWinsState,
  type Milestone,
  type Project,
  type Task,
  type TimeBlock,
  type Todo,
  type TreeNode,
} from "@/lib/types";
import { usePrefs } from "./use-prefs";

export interface StoreApi {
  state: MicroWinsState;
  /** Aktuální den uživatele - obnovuje se po půlnoci i po návratu do okna. */
  today: ISODate;
  hydrated: boolean;
  addCategory: (parentId: string | null, name: string, icon?: string) => TreeNode;
  addMetric: (parentId: string | null, input: actions.MetricInput) => TreeNode;
  addCheck: (parentId: string | null, name: string) => TreeNode;
  addOnce: (parentId: string | null, input: actions.OnceInput) => actions.AddOnceResult;
  updateNode: (
    id: string,
    patch: Partial<Pick<TreeNode, "name" | "icon" | "unit" | "aggregation">>,
  ) => void;
  updateOnce: (id: string, patch: actions.OncePatch) => void;
  /** Přesune uzel s celým podstromem pod jinou složku; null = kořen. */
  moveNode: (id: string, targetId: string | null) => void;
  /** Odloží uzel do archivu (zmizí ze stromu, data zůstanou), nebo ho vrátí. */
  setNodeArchived: (id: string, archived: boolean) => void;
  /** Změní pořadí uzlů v dané složce. */
  reorderNodes: (ids: string[]) => void;
  deleteNode: (id: string) => void;
  addEntry: (input: actions.AddEntryInput) => actions.AddEntryResult;
  toggleCheck: (id: string, date?: ISODate) => actions.ToggleCheckResult;
  deleteEntry: (id: string) => void;

  createProject: (input: projectActions.ProjectInput) => Project;
  updateProject: (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => void;
  deleteProject: (id: string) => void;
  setProjectArchived: (id: string, archived: boolean) => void;
  moveProject: (id: string, direction: -1 | 1) => void;
  /** Nové pořadí po přetažení - `ids` jsou viditelné řádky shora dolů. */
  reorderProjects: (ids: string[]) => void;

  createTask: (projectId: string, input: projectActions.TaskInput) => Task;
  updateTask: (id: string, patch: Partial<Omit<Task, "id" | "projectId" | "createdAt">>) => void;
  setTaskCurrent: (id: string, value: number) => void;
  adjustTask: (id: string, delta: number) => void;
  toggleTaskDone: (id: string) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, direction: -1 | 1) => void;
  /** Nové pořadí sourozenců po přetažení. */
  reorderTasks: (ids: string[]) => void;

  /** Jednoduchý seznam. Vrací null, když text po očištění nic neobsahuje. */
  addTodo: (text: string) => Todo | null;
  renameTodo: (id: string, text: string) => void;
  /** Odškrtne (nebo vrátí zpět). Odškrtnutá položka se pak sama smaže. */
  toggleTodo: (id: string) => void;
  /** Smaže a vrátí smazanou položku, aby ji šlo nabídnout zpátky. */
  deleteTodo: (id: string) => Todo | null;
  /** Vrátí smazanou položku na její původní místo. */
  restoreTodo: (todo: Todo) => void;
  reorderTodos: (ids: string[]) => void;
  /** Termín položky; `null` ho sundá. Hodina bez data se zahodí. */
  setTodoDue: (id: string, dueDate: ISODate | null, dueTime?: string | null) => void;

  /** Plán dne - blok času, do kterého se dá pověsit položka ToDo nebo úkol. */
  addBlock: (input: blockActions.BlockInput) => TimeBlock;
  updateBlock: (
    id: string,
    patch: { title?: string; start?: number; duration?: number; date?: ISODate },
  ) => void;
  /** Posun v rámci dne - z tahu prstem, proto zvlášť a bez ostatních polí. */
  moveBlock: (id: string, start: number) => void;
  resizeBlock: (id: string, duration: number) => void;
  moveBlockToDay: (id: string, date: ISODate) => void;
  /** Odškrtne blok; blok z položky ToDo odškrtne i tu položku. */
  toggleBlockDone: (id: string) => void;
  /** Smaže a vrátí smazaný blok, aby ho šlo nabídnout zpátky. */
  deleteBlock: (id: string) => TimeBlock | null;
  restoreBlock: (block: TimeBlock) => void;

  createMilestone: (projectId: string, name: string, date: ISODate | null) => Milestone;
  updateMilestone: (id: string, patch: Partial<Pick<Milestone, "name" | "date">>) => void;
  /** Odškrtnutí milníku - procent úkolů ani projektu se nedotkne. */
  toggleMilestoneDone: (id: string) => void;
  deleteMilestone: (id: string) => void;

  reset: () => void;
  /**
   * Načte zálohu (nový formát i starší holý export). Bez options se chová jako
   * dřív - nahradí celý stav. S `scope` vezme jen jednu polovinu dat, takže se
   * dají natáhnout projekty odjinud, aniž by se sáhlo na strom winů.
   */
  importJson: (text: string, options?: { scope?: ImportScope; mode?: ImportMode }) => boolean;
  /**
   * Vyexportuje celou zálohu. V appce podle `target` buď nabídne sdílení,
   * nebo soubor rovnou uloží do Dokumentů; v prohlížeči vždycky stáhne.
   */
  exportJson: (target?: ExportTarget) => Promise<ExportOutcome>;
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
  /* Doba do smazání odškrtnuté položky ToDo je nastavení, ne data - proto se
     sem tahá z prefs a nesedí ve stavu. Nula = mizení vypnuté. */
  const ttlMs = todoTtlMs(usePrefs());
  const ttlRef = React.useRef(ttlMs);
  ttlRef.current = ttlMs;

  // Nejnovější stav i mimo render - akce potřebují číst synchronně.
  const ref = React.useRef(state);
  const commit = React.useCallback((next: MicroWinsState) => {
    ref.current = next;
    setState(next);
  }, []);

  React.useEffect(() => {
    // Testovací data z adresy `?seed` - jen ve vývoji, viz lib/dev-seed.ts.
    // Appka mohla být zavřená přes noc - odškrtnuté položky ToDo, kterým
    // mezitím vypršelo, musí být pryč ještě před prvním vykreslením.
    const loaded = todoActions.purgeTodos(applyDevSeed(loadState()), new Date(), ttlRef.current);
    ref.current = loaded;
    setState(loaded);
    setToday(todayISO());
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  /*
   * Přechod přes půlnoc: co bylo "dnes", je najednou včerejšek. Na stejném
   * tiku visí i mazání dojetých ToDo - `purgeTodos` vrací tentýž stav, když
   * není co mazat, takže se z toho nestane překreslení každou minutu.
   */
  React.useEffect(() => {
    const tick = () => {
      setToday(todayISO());
      const purged = todoActions.purgeTodos(ref.current, new Date(), ttlRef.current);
      if (purged !== ref.current) commit(purged);
    };
    const id = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [commit]);

  const api = React.useMemo<StoreApi>(
    () => ({
      state,
      today,
      hydrated,
      addCategory: (parentId, name, icon) => {
        const res = actions.addCategory(ref.current, parentId, name, icon);
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
      moveNode: (id, targetId) => commit(actions.moveNode(ref.current, id, targetId)),
      setNodeArchived: (id, archived) =>
        commit(actions.setNodeArchived(ref.current, id, archived)),
      reorderNodes: (ids) => commit(actions.reorderNodes(ref.current, ids)),
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
      reorderProjects: (ids) => commit(projectActions.reorderProjects(ref.current, ids)),

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
      reorderTasks: (ids) => commit(projectActions.reorderTasks(ref.current, ids)),

      addTodo: (text) => {
        const res = todoActions.addTodo(ref.current, text);
        if (res.todo) commit(res.state);
        return res.todo;
      },
      renameTodo: (id, text) => commit(todoActions.renameTodo(ref.current, id, text)),
      toggleTodo: (id) => commit(todoActions.toggleTodo(ref.current, id)),
      deleteTodo: (id) => {
        const todo = ref.current.todos.find((t) => t.id === id) ?? null;
        commit(todoActions.deleteTodo(ref.current, id));
        return todo;
      },
      restoreTodo: (todo) => commit(todoActions.restoreTodo(ref.current, todo)),
      reorderTodos: (ids) => commit(todoActions.reorderTodos(ref.current, ids)),
      setTodoDue: (id, dueDate, dueTime) =>
        commit(todoActions.setTodoDue(ref.current, id, dueDate, dueTime ?? null)),

      addBlock: (input) => {
        const res = blockActions.addBlock(ref.current, input);
        commit(res.state);
        return res.block;
      },
      updateBlock: (id, patch) => commit(blockActions.updateBlock(ref.current, id, patch)),
      moveBlock: (id, start) => commit(blockActions.moveBlock(ref.current, id, start)),
      resizeBlock: (id, duration) => commit(blockActions.resizeBlock(ref.current, id, duration)),
      moveBlockToDay: (id, date) => commit(blockActions.moveBlockToDay(ref.current, id, date)),
      toggleBlockDone: (id) => commit(blockActions.toggleBlockDone(ref.current, id)),
      deleteBlock: (id) => {
        const block = ref.current.timeBlocks.find((b) => b.id === id) ?? null;
        commit(blockActions.deleteBlock(ref.current, id));
        return block;
      },
      restoreBlock: (block) => commit(blockActions.restoreBlock(ref.current, block)),

      createMilestone: (projectId, name, date) => {
        const res = projectActions.createMilestone(ref.current, projectId, name, date);
        commit(res.state);
        return res.milestone;
      },
      updateMilestone: (id, patch) =>
        commit(projectActions.updateMilestone(ref.current, id, patch)),
      toggleMilestoneDone: (id) => commit(projectActions.toggleMilestoneDone(ref.current, id)),
      deleteMilestone: (id) => commit(projectActions.deleteMilestone(ref.current, id)),

      reset: () => commit(EMPTY_STATE),
      importJson: (text, options) => {
        const parsed = parseBackup(text);
        if (!parsed) return false;
        const scope = options?.scope ?? "all";
        const mode = options?.mode ?? "replace";
        commit(mergeState(ref.current, parsed.state, scope, mode));
        // Nastavení vzhledu patří k celé záloze; při načítání jedné poloviny
        // by přepsalo volby, o kterých uživatel nic neříkal.
        if (scope === "all" && mode === "replace") applySettings(parsed.settings);
        return true;
      },
      exportJson: (target) => exportBackup(ref.current, target),
    }),
    [state, today, hydrated, commit],
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
