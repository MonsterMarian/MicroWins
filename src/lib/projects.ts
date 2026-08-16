import { addDays, diffDays, todayISO } from "./date";
import type {
  ISODate,
  MicroWinsState,
  Milestone,
  Project,
  Snapshot,
  Task,
  TaskSnapshot,
} from "./types";

/**
 * Výpočty postupu projektů (čisté funkce).
 *
 * - Úkol bez podúkolů: procenta = current / target.
 * - Úkol s podúkoly: vážený průměr podúkolů (vlastní hodnota se ignoruje).
 * - Projekt: vážený průměr top-level úkolů. Bez úkolů = 0 %.
 * - Historie postupu žije v `snapshots` - jeden zápis na den a projekt.
 */

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function roundPercent(n: number): number {
  return Math.round(clampPercent(n) * 10) / 10;
}

/**
 * Váha úkolu v průměru. **Nula znamená „nepočítá se"** - úkol zůstane
 * v seznamu, dá se posouvat i odškrtávat, ale procenty projektu nehne.
 * Hodí se na poznámky, čekání na někoho jiného a na kroky, které jsou
 * povinné, ale nejsou to práce.
 */
export function weightOf(task: Task): number {
  return Number.isFinite(task.weight) ? Math.max(0, task.weight) : 1;
}

/**
 * Procenta do UI se zaokrouhlují dolů - 99,7 % ještě není hotovo,
 * takže se nemá zobrazovat 100 %.
 */
export function displayPercent(n: number): number {
  return Math.floor(clampPercent(n) + 1e-9);
}

// --- výběry -----------------------------------------------------------------

export function projectById(state: MicroWinsState, id: string): Project | undefined {
  return state.projects.find((p) => p.id === id);
}

export function taskById(state: MicroWinsState, id: string): Task | undefined {
  return state.tasks.find((t) => t.id === id);
}

export function tasksOfProject(state: MicroWinsState, projectId: string): Task[] {
  return state.tasks
    .filter((t) => t.projectId === projectId && t.parentId === null)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function subtasksOf(state: MicroWinsState, taskId: string): Task[] {
  return state.tasks
    .filter((t) => t.parentId === taskId)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function allTasksOfProject(state: MicroWinsState, projectId: string): Task[] {
  return state.tasks.filter((t) => t.projectId === projectId);
}

export function milestonesOfProject(state: MicroWinsState, projectId: string): Milestone[] {
  return state.milestones
    .filter((m) => m.projectId === projectId)
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

// --- procenta ---------------------------------------------------------------

export function taskPercent(state: MicroWinsState, task: Task): number {
  const children = subtasksOf(state, task.id);
  if (children.length > 0) {
    const totalWeight = children.reduce((s, c) => s + weightOf(c), 0);
    // Samé nuly = není z čeho průměrovat. Postup pak řídí vlastní hodnota
    // úkolu, ne prázdný průměr - jinak by úkol navždy visel na nule.
    if (totalWeight === 0) return task.target > 0 ? clampPercent((task.current / task.target) * 100) : 0;
    const sum = children.reduce((s, c) => s + taskPercent(state, c) * weightOf(c), 0);
    return clampPercent(sum / totalWeight);
  }
  if (task.target <= 0) return task.current > 0 ? 100 : 0;
  return clampPercent((task.current / task.target) * 100);
}

export function projectPercent(state: MicroWinsState, projectId: string): number {
  const tasks = tasksOfProject(state, projectId);
  if (tasks.length === 0) return 0;
  const totalWeight = tasks.reduce((s, t) => s + weightOf(t), 0);
  // Všechny úkoly s váhou 0 - projekt nemá co počítat, stejně jako bez úkolů.
  if (totalWeight === 0) return 0;
  const sum = tasks.reduce((s, t) => s + taskPercent(state, t) * weightOf(t), 0);
  return clampPercent(sum / totalWeight);
}

export function isTaskDone(state: MicroWinsState, task: Task): boolean {
  return taskPercent(state, task) >= 99.995;
}

/**
 * Úkol, který se dá jen odškrtnout: cíl 1 a žádné podúkoly. Nemá smysl mu
 * kreslit pruh ani "1 / 1" - v seznamu z toho byl řádek plný stovek procent,
 * který nic neříkal. Kreslí se jako zaškrtávátko.
 */
export function isBinaryTask(state: MicroWinsState, task: Task): boolean {
  return task.target <= 1 && subtasksOf(state, task.id).length === 0;
}

/** Kolik podúkolů je hotových - podklad pro "14 / 21 podúkolů". */
export function subtaskCounts(
  state: MicroWinsState,
  taskId: string,
): { done: number; total: number } {
  const children = subtasksOf(state, taskId);
  return { done: children.filter((c) => isTaskDone(state, c)).length, total: children.length };
}

// --- historie úkolu ---------------------------------------------------------

export function taskSnapshotsOf(state: MicroWinsState, taskId: string): TaskSnapshot[] {
  return state.taskSnapshots
    .filter((s) => s.taskId === taskId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Dnešní přírůstek úkolu v procentních bodech - stejný údaj, jaký má projekt
 * u velkého čísla.
 *
 * Základ je poslední otisk **před** dneškem. Když žádný není, rozhoduje stáří
 * úkolu: založený dnes roste od nuly, starší úkol bez historie hlásí nulu.
 * Ta druhá věta je schválně opatrná - data z doby před otisky nebo z importu
 * historii neznají a tvářit se, že dnes narostl celý postup, by byla lež.
 */
export function taskDeltaToday(
  state: MicroWinsState,
  task: Task,
  today: ISODate = todayISO(),
): number {
  const percent = taskPercent(state, task);
  const history = taskSnapshotsOf(state, task.id).filter((s) => s.date < today);
  if (history.length > 0) return percent - history[history.length - 1].percent;
  return task.createdAt.slice(0, 10) === today ? percent : 0;
}

// --- historie ---------------------------------------------------------------

export function snapshotsOfProject(state: MicroWinsState, projectId: string): Snapshot[] {
  return state.snapshots
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Poslední známý postup ke dni `date` (včetně). */
export function percentAt(
  state: MicroWinsState,
  projectId: string,
  date: ISODate,
): number | null {
  let last: number | null = null;
  for (const s of snapshotsOfProject(state, projectId)) {
    if (s.date <= date) last = s.percent;
    else break;
  }
  return last;
}

export interface SeriesPoint {
  date: ISODate;
  percent: number;
}

/**
 * Denní řada od začátku projektu (nebo prvního otisku) do dneška.
 * Dny bez otisku dědí poslední známou hodnotu - graf tak neskáče na nulu.
 */
export function progressSeries(
  state: MicroWinsState,
  projectId: string,
  today: ISODate = todayISO(),
): SeriesPoint[] {
  const project = projectById(state, projectId);
  if (!project) return [];
  const snaps = snapshotsOfProject(state, projectId);
  const start = snaps.length ? minDate(project.startDate, snaps[0].date) : project.startDate;
  const end = today < start ? start : today;

  const byDate = new Map(snaps.map((s) => [s.date, s.percent]));
  const out: SeriesPoint[] = [];
  let last = 0;
  const span = Math.min(diffDays(start, end), 366 * 3);
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    if (byDate.has(date)) last = byDate.get(date)!;
    out.push({ date, percent: last });
  }
  // Aktuální stav má vždy přednost před posledním otiskem.
  if (out.length) out[out.length - 1] = { date: end, percent: projectPercent(state, projectId) };
  return out;
}

function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export interface DailyChange {
  date: ISODate;
  from: number;
  to: number;
  delta: number;
}

/** Deník změn: "3. 8. 2026 (po) 62 % → 65 % (+3 %)", nejnovější první. */
export function dailyChanges(
  state: MicroWinsState,
  projectId: string,
  today: ISODate = todayISO(),
): DailyChange[] {
  const series = progressSeries(state, projectId, today);
  const out: DailyChange[] = [];
  for (let i = 1; i < series.length; i++) {
    const from = series[i - 1].percent;
    const to = series[i].percent;
    if (Math.abs(to - from) < 0.05) continue;
    out.push({ date: series[i].date, from, to, delta: to - from });
  }
  return out.reverse();
}

// --- souhrn projektu --------------------------------------------------------

export interface ProjectStats {
  project: Project;
  percent: number;
  /** Změna od konce včerejška - číslo vedle velkého procenta. */
  deltaToday: number;
  /** Dní od startu do dneška. */
  daysElapsed: number;
  /** null = bez deadlinu. */
  daysLeft: number | null;
  /** Celková délka projektu ve dnech (jen s deadlinem). */
  totalDays: number | null;
  /** Kolik % denně je potřeba do deadlinu. */
  targetPerDay: number | null;
  tasksTotal: number;
  tasksDone: number;
  overdue: boolean;
  lastActivity: ISODate | null;
  /** Den, kdy projekt naposledy vyskočil na 100 %; null = ještě není hotový. */
  completedOn: ISODate | null;
}

/**
 * Den, od kterého projekt drží stovku.
 *
 * Hledá se zpětně: kdo spadl pod 100 % a pak se tam vrátil, "dokončil" projekt
 * až podruhé. První dosažení stovky by u takového projektu tvrdilo, že je
 * hotový od jara, i když se v létě práce znovu otevřela.
 */
function completionDate(snaps: Snapshot[], percent: number): ISODate | null {
  if (percent < 100) return null;
  let date: ISODate | null = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].percent < 100) break;
    date = snaps[i].date;
  }
  return date;
}

export function projectStats(
  state: MicroWinsState,
  projectId: string,
  today: ISODate = todayISO(),
): ProjectStats | null {
  const project = projectById(state, projectId);
  if (!project) return null;

  const percent = projectPercent(state, projectId);
  const yesterday = percentAt(state, projectId, addDays(today, -1)) ?? 0;
  const tasks = tasksOfProject(state, projectId);
  const daysLeft = project.deadline ? diffDays(today, project.deadline) : null;
  const totalDays = project.deadline ? diffDays(project.startDate, project.deadline) : null;
  const snaps = snapshotsOfProject(state, projectId);

  return {
    project,
    percent,
    deltaToday: percent - yesterday,
    daysElapsed: Math.max(0, diffDays(project.startDate, today)),
    daysLeft,
    totalDays,
    targetPerDay:
      daysLeft !== null && daysLeft > 0 ? (100 - percent) / daysLeft : daysLeft === 0 ? 100 - percent : null,
    tasksTotal: tasks.length,
    tasksDone: tasks.filter((t) => isTaskDone(state, t)).length,
    overdue: daysLeft !== null && daysLeft < 0 && percent < 100,
    lastActivity: snaps.length ? snaps[snaps.length - 1].date : null,
    completedOn: completionDate(snaps, percent),
  };
}

/**
 * Prostřední kolečko na statistikách projektu.
 *
 * U rozdělaného projektu je to postup ke termínu: `26` a pod tím `z 30`.
 * Jakmile je hotovo, kolečko se zastaví - prstenec je celý a zůstane jediné
 * číslo, kolik dní to trvalo. Dopočítávat dny do termínu u projektu, který je
 * hotový o čtyři dny dřív, znamená ukazovat, jak dlouho už je dodělaný.
 */
export interface DayRing {
  /** Hodnota prstenu 0-100. */
  value: number;
  /** Číslo uvnitř kolečka. */
  days: number;
  /** Jmenovatel pod ním; null = neukazovat. */
  total: number | null;
}

export function dayRing(stats: ProjectStats): DayRing {
  if (stats.percent >= 100) {
    // Bez otisku (starý projekt, ruční import) není odkud vzít den dokončení -
    // pak je poctivější ukázat dnešek než tvrdit nulu.
    const days = stats.completedOn
      ? Math.max(0, diffDays(stats.project.startDate, stats.completedOn))
      : stats.daysElapsed;
    return { value: 100, days, total: null };
  }

  const value =
    stats.totalDays && stats.totalDays > 0
      ? Math.min(100, (stats.daysElapsed / stats.totalDays) * 100)
      : Math.min(100, stats.daysElapsed);

  return { value, days: stats.daysElapsed, total: stats.totalDays };
}

/**
 * Jak si projekt stojí proti kalendáři. Bez deadlinu není s čím porovnávat -
 * tam se nic nebarví, protože "pozadu" nedává smysl, když termín neexistuje.
 *
 * Pásmo ±5 bodů kolem očekávaného postupu je schválně: kdo je den před
 * plánem, nemá vidět jinou barvu než ten, kdo je přesně na plánu.
 */
export type Pace = "none" | "done" | "ahead" | "behind" | "late";

export function pace(stats: ProjectStats): Pace {
  if (stats.percent >= 100) return "done";
  if (stats.overdue) return "late";
  if (stats.totalDays === null || stats.totalDays <= 0) return "none";
  const expected = clampPercent((stats.daysElapsed / stats.totalDays) * 100);
  if (stats.percent < expected - 5) return "behind";
  if (stats.percent > expected + 5) return "ahead";
  return "none";
}

export const PACE_LABEL: Record<Pace, string> = {
  none: "podle plánu",
  done: "hotovo",
  ahead: "napřed",
  behind: "ve skluzu",
  late: "po termínu",
};

// --- filtry a řazení seznamu ------------------------------------------------

export type ProjectFilter = "all" | "active" | "done" | "deadline" | "overdue" | "archived";
export type ProjectSort = "custom" | "name" | "progress" | "deadline" | "recent";

export const PROJECT_FILTER_LABEL: Record<ProjectFilter, string> = {
  all: "Bez filtru",
  active: "Rozpracované",
  done: "Hotové",
  deadline: "S deadlinem",
  overdue: "Po termínu",
  archived: "Archiv",
};

export const PROJECT_SORT_LABEL: Record<ProjectSort, string> = {
  custom: "Vlastní pořadí",
  name: "Podle názvu",
  progress: "Podle postupu",
  deadline: "Podle deadlinu",
  recent: "Naposledy upravené",
};

export function filterProjects(
  state: MicroWinsState,
  filter: ProjectFilter,
  today: ISODate = todayISO(),
): Project[] {
  return state.projects.filter((p) => {
    if (filter === "archived") return p.archivedAt !== null;
    if (p.archivedAt !== null) return false;
    const stats = projectStats(state, p.id, today);
    if (!stats) return false;
    switch (filter) {
      case "active":
        return stats.percent < 100;
      case "done":
        return stats.percent >= 100;
      case "deadline":
        return p.deadline !== null;
      case "overdue":
        return stats.overdue;
      default:
        return true;
    }
  });
}

export function sortProjects(
  state: MicroWinsState,
  projects: Project[],
  sort: ProjectSort,
): Project[] {
  const copy = [...projects];
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    case "progress":
      return copy.sort((a, b) => projectPercent(state, b.id) - projectPercent(state, a.id));
    case "deadline":
      return copy.sort((a, b) =>
        (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31"),
      );
    case "recent":
      return copy.sort((a, b) => {
        const la = snapshotsOfProject(state, a.id).at(-1)?.date ?? a.createdAt.slice(0, 10);
        const lb = snapshotsOfProject(state, b.id).at(-1)?.date ?? b.createdAt.slice(0, 10);
        return lb.localeCompare(la);
      });
    default:
      return copy.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  }
}

export type TaskFilter = "all" | "open" | "done" | "today" | "overdue";

export const TASK_FILTER_LABEL: Record<TaskFilter, string> = {
  all: "Všechny",
  open: "Nedokončené",
  done: "Hotové",
  today: "Termín dnes",
  overdue: "Po termínu",
};

export function filterTasks(
  state: MicroWinsState,
  tasks: Task[],
  filter: TaskFilter,
  today: ISODate = todayISO(),
): Task[] {
  return tasks.filter((t) => {
    const done = isTaskDone(state, t);
    switch (filter) {
      case "open":
        return !done;
      case "done":
        return done;
      case "today":
        return t.dueDate === today;
      case "overdue":
        return t.dueDate !== null && t.dueDate < today && !done;
      default:
        return true;
    }
  });
}

// --- souhrn napříč projekty -------------------------------------------------

export interface PortfolioStats {
  projects: number;
  activeProjects: number;
  doneProjects: number;
  tasksTotal: number;
  tasksDone: number;
  avgPercent: number;
  /** Součet dnešních přírůstků přes všechny projekty (v procentních bodech). */
  todayDelta: number;
  dueToday: number;
  overdue: number;
}

export function portfolioStats(
  state: MicroWinsState,
  today: ISODate = todayISO(),
): PortfolioStats {
  const active = state.projects.filter((p) => p.archivedAt === null);
  const stats = active.map((p) => projectStats(state, p.id, today)!).filter(Boolean);
  const tasks = state.tasks.filter((t) =>
    active.some((p) => p.id === t.projectId),
  );

  return {
    projects: active.length,
    activeProjects: stats.filter((s) => s.percent < 100).length,
    doneProjects: stats.filter((s) => s.percent >= 100).length,
    tasksTotal: tasks.length,
    tasksDone: tasks.filter((t) => isTaskDone(state, t)).length,
    avgPercent: stats.length ? stats.reduce((s, x) => s + x.percent, 0) / stats.length : 0,
    todayDelta: stats.reduce((s, x) => s + Math.max(0, x.deltaToday), 0),
    dueToday: tasks.filter((t) => t.dueDate === today && !isTaskDone(state, t)).length,
    overdue: tasks.filter((t) => t.dueDate !== null && t.dueDate < today && !isTaskDone(state, t))
      .length,
  };
}

export interface ActivityPoint {
  date: ISODate;
  /** Součet přírůstků procent napříč projekty (procentní body). */
  gain: number;
}

/**
 * Denní aktivita napříč projekty - kolik procentních bodů celkem přibylo.
 * Klesající dny (oprava hodnoty) se do součtu neberou, aby graf měřil práci.
 */
export function portfolioActivity(
  state: MicroWinsState,
  days = 30,
  today: ISODate = todayISO(),
): ActivityPoint[] {
  const byDate = new Map<ISODate, number>();
  for (const project of state.projects) {
    for (const change of dailyChanges(state, project.id, today)) {
      if (change.delta <= 0) continue;
      byDate.set(change.date, (byDate.get(change.date) ?? 0) + change.delta);
    }
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, -(days - 1 - i));
    return { date, gain: Math.round((byDate.get(date) ?? 0) * 10) / 10 };
  });
}

/** Dnešní přírůstky napříč projekty - podklad pro sekci "Dnes". */
export function todayMovers(
  state: MicroWinsState,
  today: ISODate = todayISO(),
): { project: Project; delta: number; percent: number }[] {
  return state.projects
    .filter((p) => p.archivedAt === null)
    .map((p) => {
      const stats = projectStats(state, p.id, today)!;
      return { project: p, delta: stats.deltaToday, percent: stats.percent };
    })
    .filter((x) => Math.abs(x.delta) >= 0.05)
    .sort((a, b) => b.delta - a.delta);
}
