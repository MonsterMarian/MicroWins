import { addDays, todayISO } from "./date";
import type {
  Entry,
  ISODate,
  MicroWinsState,
  Microwin,
  Project,
  Snapshot,
  Task,
  TreeNode,
} from "./types";
import { STATE_VERSION } from "./types";

/**
 * Ukázková data.
 *
 * Strom je přesně podle zadání:
 *  - Business / cold calls / "X cold calls za den"  [2; 1.1.2026] [4; 5.6.2026]
 *  - Fitness  / "X H tréninku"
 *
 * Projekty odpovídají tomu, co aplikace umí: cíl, deadline, úkoly s postupem
 * a historie postupu pro graf.
 */
export function seedState(today: ISODate = todayISO()): MicroWinsState {
  const stamp = (offset: number) => new Date(Date.now() + offset).toISOString();

  const nodes: TreeNode[] = [
    { id: "cat_business", parentId: null, kind: "category", name: "Business", createdAt: stamp(0) },
    {
      id: "cat_coldcalls",
      parentId: "cat_business",
      kind: "category",
      name: "cold calls",
      createdAt: stamp(1),
    },
    {
      id: "met_coldcalls",
      parentId: "cat_coldcalls",
      kind: "metric",
      name: "X cold calls za den",
      aggregation: "sum",
      createdAt: stamp(2),
    },
    { id: "cat_fitness", parentId: null, kind: "category", name: "Fitness", createdAt: stamp(3) },
    {
      id: "met_gym",
      parentId: "cat_fitness",
      kind: "metric",
      name: "X tréninku",
      unit: "H",
      aggregation: "sum",
      createdAt: stamp(4),
    },
  ];

  const entry = (id: string, metricId: string, date: ISODate, value: number): Entry => ({
    id,
    metricId,
    date,
    value,
    createdAt: stamp(0),
    backdated: true,
  });

  const entries: Entry[] = [
    entry("ent_cc1", "met_coldcalls", "2026-01-01", 2),
    entry("ent_cc2", "met_coldcalls", "2026-06-05", 4),
    entry("ent_gym1", "met_gym", addDays(today, -3), 1.5),
    entry("ent_gym2", "met_gym", addDays(today, -1), 2.5),
  ];

  const microwins: Microwin[] = [
    {
      id: "win_cc1",
      metricId: "met_coldcalls",
      date: "2026-01-01",
      value: 2,
      previousRecord: 0,
      firstEver: true,
      createdAt: stamp(0),
    },
    {
      id: "win_cc2",
      metricId: "met_coldcalls",
      date: "2026-06-05",
      value: 4,
      previousRecord: 2,
      firstEver: false,
      createdAt: stamp(0),
    },
    {
      id: "win_gym1",
      metricId: "met_gym",
      date: addDays(today, -3),
      value: 1.5,
      previousRecord: 0,
      firstEver: true,
      createdAt: stamp(0),
    },
    {
      id: "win_gym2",
      metricId: "met_gym",
      date: addDays(today, -1),
      value: 2.5,
      previousRecord: 1.5,
      firstEver: false,
      createdAt: stamp(0),
    },
  ];

  // --- projekty -------------------------------------------------------------

  const projects: Project[] = [];
  const tasks: Task[] = [];
  const snapshots: Snapshot[] = [];

  const addProject = (
    id: string,
    name: string,
    icon: string,
    startOffset: number,
    deadlineOffset: number | null,
    description: string,
    taskDefs: { name: string; target: number; current: number; unit?: string; step?: number }[],
    /** Průběh postupu v procentech od startu do dneška (pro graf). */
    curve: number[],
  ) => {
    const startDate = addDays(today, startOffset);
    projects.push({
      id,
      name,
      icon,
      startDate,
      deadline: deadlineOffset === null ? null : addDays(today, deadlineOffset),
      description,
      order: projects.length,
      createdAt: stamp(projects.length),
      archivedAt: null,
    });

    taskDefs.forEach((t, i) => {
      tasks.push({
        id: `${id}_t${i}`,
        projectId: id,
        parentId: null,
        name: t.name,
        icon: "📝",
        target: t.target,
        current: t.current,
        unit: t.unit,
        step: t.step ?? Math.max(1, Math.round(t.target / 20)),
        weight: 1,
        dueDate: null,
        milestoneId: null,
        description: "",
        order: i,
        createdAt: stamp(i),
        completedAt: t.current >= t.target ? stamp(i) : null,
      });
    });

    curve.forEach((percent, i) => {
      snapshots.push({
        projectId: id,
        date: addDays(startDate, Math.round((i / Math.max(1, curve.length - 1)) * -startOffset)),
        percent,
      });
    });
  };

  addProject(
    "prj_clicks",
    "10K kliků",
    "🖱️",
    -18,
    12,
    "Deset tisíc kliků do konce srpna.",
    [
      { name: "2000", target: 2000, current: 2000 },
      { name: "2000", target: 2000, current: 2000 },
      { name: "2000", target: 2000, current: 2000 },
      { name: "2000", target: 2000, current: 630 },
      { name: "2000", target: 2000, current: 0 },
      { name: "60 najednou", target: 60, current: 60 },
      { name: "rozcvička", target: 10, current: 10 },
      { name: "finální dávka", target: 500, current: 0 },
    ],
    [0, 4, 9, 14, 27, 30, 34, 39, 44, 52, 57, 58, 62, 65, 66],
  );

  addProject(
    "prj_noshorts",
    "30 no shorts",
    "📵",
    -18,
    null,
    "Třicet dní bez krátkých videí.",
    [{ name: "dní bez shorts", target: 30, current: 18, unit: "dní", step: 1 }],
    [0, 7, 13, 20, 27, 33, 40, 43, 47, 50, 53, 57, 60],
  );

  addProject(
    "prj_reading",
    "Čtení",
    "📖",
    -36,
    45,
    "Dvanáct knih za rok.",
    [
      { name: "stran přečteno", target: 3000, current: 1000, unit: "str", step: 10 },
      { name: "knih dočteno", target: 12, current: 4, unit: "ks", step: 1 },
    ],
    [0, 5, 9, 12, 16, 20, 24, 27, 30, 33],
  );

  return {
    version: STATE_VERSION,
    nodes,
    entries,
    microwins,
    projects,
    tasks,
    milestones: [],
    snapshots,
  };
}
