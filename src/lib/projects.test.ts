import { describe, expect, it } from "vitest";
import {
  adjustTask,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  moveTask,
  setTaskCurrent,
  toggleTaskDone,
  updateTask,
} from "./project-actions";
import {
  dailyChanges,
  filterProjects,
  isTaskDone,
  portfolioStats,
  progressSeries,
  projectPercent,
  projectStats,
  sortProjects,
  taskPercent,
  tasksOfProject,
} from "./projects";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const TODAY = "2026-08-06";

function withProject(deadlineOffsetDays: number | null = null) {
  const { state, project } = createProject(
    EMPTY_STATE,
    {
      name: "10K kliků",
      startDate: "2026-07-19",
      deadline: deadlineOffsetDays === null ? null : "2026-08-18",
    },
    TODAY,
  );
  return { state, projectId: project.id };
}

describe("procenta úkolů a projektu", () => {
  it("úkol počítá postup jako current / target", () => {
    const { state, projectId } = withProject();
    const r = createTask(state, projectId, { name: "2000", target: 2000, current: 630 }, TODAY);

    expect(Math.round(taskPercent(r.state, r.task) * 10) / 10).toBe(31.5);
    expect(isTaskDone(r.state, r.task)).toBe(false);
  });

  it("projekt je vážený průměr top-level úkolů", () => {
    const { state, projectId } = withProject();
    let s: MicroWinsState = state;
    s = createTask(s, projectId, { name: "a", target: 100, current: 100 }, TODAY).state;
    s = createTask(s, projectId, { name: "b", target: 100, current: 0 }, TODAY).state;

    expect(projectPercent(s, projectId)).toBe(50);
  });

  it("váha úkolu mění jeho podíl", () => {
    const { state, projectId } = withProject();
    let s: MicroWinsState = state;
    s = createTask(s, projectId, { name: "a", target: 100, current: 100, weight: 3 }, TODAY).state;
    s = createTask(s, projectId, { name: "b", target: 100, current: 0, weight: 1 }, TODAY).state;

    expect(projectPercent(s, projectId)).toBe(75);
  });

  it("úkol s podúkoly bere průměr podúkolů", () => {
    const { state, projectId } = withProject();
    const parent = createTask(state, projectId, { name: "kapitola", target: 1 }, TODAY);
    let s = parent.state;
    s = createTask(s, projectId, { name: "a", target: 10, current: 10, parentId: parent.task.id }, TODAY).state;
    s = createTask(s, projectId, { name: "b", target: 10, current: 5, parentId: parent.task.id }, TODAY).state;

    expect(taskPercent(s, parent.task)).toBe(75);
    expect(projectPercent(s, projectId)).toBe(75);
  });

  it("hodnota se ořízne na rozsah 0 až target", () => {
    const { state, projectId } = withProject();
    const r = createTask(state, projectId, { name: "a", target: 100, current: 0 }, TODAY);

    const over = setTaskCurrent(r.state, r.task.id, 500, TODAY);
    expect(tasksOfProject(over, projectId)[0].current).toBe(100);

    const under = setTaskCurrent(r.state, r.task.id, -20, TODAY);
    expect(tasksOfProject(under, projectId)[0].current).toBe(0);
  });

  it("tlačítka +/- posouvají o krok a přepínač dokončí úkol", () => {
    const { state, projectId } = withProject();
    const r = createTask(state, projectId, { name: "a", target: 10, current: 0, step: 2 }, TODAY);

    const plus = adjustTask(r.state, r.task.id, 2, TODAY);
    expect(tasksOfProject(plus, projectId)[0].current).toBe(2);

    const done = toggleTaskDone(plus, r.task.id, TODAY);
    expect(tasksOfProject(done, projectId)[0].current).toBe(10);
    expect(tasksOfProject(done, projectId)[0].completedAt).not.toBeNull();

    const undone = toggleTaskDone(done, r.task.id, TODAY);
    expect(tasksOfProject(undone, projectId)[0].current).toBe(0);
    expect(tasksOfProject(undone, projectId)[0].completedAt).toBeNull();
  });
});

describe("souhrn projektu", () => {
  it("počítá dny, zbývající dny a denní tempo", () => {
    const { state, projectId } = withProject(30);
    const s = createTask(state, projectId, { name: "a", target: 100, current: 66 }, TODAY).state;
    const stats = projectStats(s, projectId, TODAY)!;

    expect(stats.percent).toBe(66);
    expect(stats.daysElapsed).toBe(18); // 19. 7. -> 6. 8.
    expect(stats.daysLeft).toBe(12); // 6. 8. -> 18. 8.
    expect(Math.round(stats.targetPerDay! * 10) / 10).toBe(2.8);
    expect(stats.overdue).toBe(false);
  });

  it("hlásí skluz po termínu", () => {
    const { state, project } = createProject(
      EMPTY_STATE,
      { name: "pozdní", startDate: "2026-07-01", deadline: "2026-08-01" },
      TODAY,
    );
    const s = createTask(state, project.id, { name: "a", target: 10, current: 1 }, TODAY).state;

    expect(projectStats(s, project.id, TODAY)!.overdue).toBe(true);
  });

  it("počítá hotové úkoly", () => {
    const { state, projectId } = withProject();
    let s: MicroWinsState = state;
    s = createTask(s, projectId, { name: "a", target: 10, current: 10 }, TODAY).state;
    s = createTask(s, projectId, { name: "b", target: 10, current: 4 }, TODAY).state;

    const stats = projectStats(s, projectId, TODAY)!;
    expect(stats.tasksDone).toBe(1);
    expect(stats.tasksTotal).toBe(2);
  });
});

describe("historie postupu", () => {
  it("řada dědí poslední známou hodnotu a končí dneškem", () => {
    const { state, projectId } = withProject();
    let s = createTask(state, projectId, { name: "a", target: 100, current: 0 }, "2026-08-01").state;
    s = setTaskCurrent(s, tasksOfProject(s, projectId)[0].id, 40, "2026-08-03");
    s = setTaskCurrent(s, tasksOfProject(s, projectId)[0].id, 66, TODAY);

    const series = progressSeries(s, projectId, TODAY);
    expect(series[0].date).toBe("2026-07-19");
    expect(series.at(-1)).toEqual({ date: TODAY, percent: 66 });
    // 4. a 5. 8. nemají otisk - drží hodnotu ze 3. 8.
    expect(series.find((p) => p.date === "2026-08-05")?.percent).toBe(40);
  });

  it("deník změn ukáže z kolika na kolik a o kolik", () => {
    const { state, projectId } = withProject();
    let s = createTask(state, projectId, { name: "a", target: 100, current: 0 }, "2026-08-01").state;
    s = setTaskCurrent(s, tasksOfProject(s, projectId)[0].id, 62, "2026-08-03");
    s = setTaskCurrent(s, tasksOfProject(s, projectId)[0].id, 65, "2026-08-04");

    const changes = dailyChanges(s, projectId, TODAY);
    expect(changes[0].date).toBe("2026-08-04");
    expect(changes[0].from).toBe(62);
    expect(changes[0].to).toBe(65);
    expect(changes[0].delta).toBe(3);
  });

  it("dnešní přírůstek se počítá proti včerejšku", () => {
    const { state, projectId } = withProject();
    let s = createTask(state, projectId, { name: "a", target: 100, current: 60 }, "2026-08-05").state;
    s = setTaskCurrent(s, tasksOfProject(s, projectId)[0].id, 66, TODAY);

    expect(projectStats(s, projectId, TODAY)!.deltaToday).toBe(6);
  });
});

describe("seznam projektů", () => {
  it("filtry oddělí rozpracované, hotové i archiv", () => {
    let s: MicroWinsState = EMPTY_STATE;
    const a = createProject(s, { name: "hotový", startDate: "2026-07-01" }, TODAY);
    s = createTask(a.state, a.project.id, { name: "x", target: 1, current: 1 }, TODAY).state;
    const b = createProject(s, { name: "rozdělaný", startDate: "2026-07-01" }, TODAY);
    s = createTask(b.state, b.project.id, { name: "y", target: 10, current: 2 }, TODAY).state;

    expect(filterProjects(s, "done", TODAY).map((p) => p.name)).toEqual(["hotový"]);
    expect(filterProjects(s, "active", TODAY).map((p) => p.name)).toEqual(["rozdělaný"]);
    expect(filterProjects(s, "all", TODAY)).toHaveLength(2);
  });

  it("řazení podle postupu dá nejdál dotažený projekt první", () => {
    let s: MicroWinsState = EMPTY_STATE;
    const a = createProject(s, { name: "A" }, TODAY);
    s = createTask(a.state, a.project.id, { name: "x", target: 10, current: 2 }, TODAY).state;
    const b = createProject(s, { name: "B" }, TODAY);
    s = createTask(b.state, b.project.id, { name: "y", target: 10, current: 9 }, TODAY).state;

    const sorted = sortProjects(s, s.projects, "progress");
    expect(sorted[0].name).toBe("B");
  });

  it("smazání projektu odklidí úkoly i otisky", () => {
    const { state, projectId } = withProject();
    const s = createTask(state, projectId, { name: "a", target: 10 }, TODAY).state;
    const after = deleteProject(s, projectId);

    expect(after.projects).toHaveLength(0);
    expect(after.tasks).toHaveLength(0);
    expect(after.snapshots).toHaveLength(0);
  });

  it("smazání úkolu vezme s sebou podúkoly", () => {
    const { state, projectId } = withProject();
    const parent = createTask(state, projectId, { name: "p", target: 1 }, TODAY);
    const s = createTask(
      parent.state,
      projectId,
      { name: "c", target: 1, parentId: parent.task.id },
      TODAY,
    ).state;

    expect(deleteTask(s, parent.task.id, TODAY).tasks).toHaveLength(0);
  });

  it("přesun úkolu prohodí pořadí", () => {
    const { state, projectId } = withProject();
    let s = createTask(state, projectId, { name: "první", target: 1 }, TODAY).state;
    s = createTask(s, projectId, { name: "druhý", target: 1 }, TODAY).state;

    const moved = moveTask(s, tasksOfProject(s, projectId)[1].id, -1);
    expect(tasksOfProject(moved, projectId).map((t) => t.name)).toEqual(["druhý", "první"]);
  });

  it("přejmenování a změna cíle úkolu drží hodnotu v rozsahu", () => {
    const { state, projectId } = withProject();
    const r = createTask(state, projectId, { name: "a", target: 100, current: 80 }, TODAY);
    const after = updateTask(r.state, r.task.id, { target: 50 }, TODAY);

    expect(tasksOfProject(after, projectId)[0].current).toBe(50);
    expect(projectPercent(after, projectId)).toBe(100);
  });
});

describe("souhrn napříč projekty", () => {
  it("spočítá projekty, úkoly i dnešní přírůstek", () => {
    let s: MicroWinsState = EMPTY_STATE;
    const a = createProject(s, { name: "A", startDate: "2026-08-01" }, TODAY);
    s = createTask(a.state, a.project.id, { name: "x", target: 10, current: 5 }, "2026-08-05").state;
    s = setTaskCurrent(s, s.tasks[0].id, 8, TODAY);

    const p = portfolioStats(s, TODAY);
    expect(p.projects).toBe(1);
    expect(p.tasksTotal).toBe(1);
    expect(p.avgPercent).toBe(80);
    expect(p.todayDelta).toBe(30);
  });
});
