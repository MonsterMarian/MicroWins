import { describe, expect, it } from "vitest";
import {
  adjustTask,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  moveTask,
  reorderProjects,
  reorderTasks,
  setTaskCurrent,
  toggleTaskDone,
  updateTask,
} from "./project-actions";
import {
  dailyChanges,
  dayRing,
  filterProjects,
  isBinaryTask,
  isTaskDone,
  pace,
  portfolioStats,
  progressSeries,
  projectPercent,
  projectStats,
  sortProjects,
  subtaskCounts,
  subtasksOf,
  taskById,
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

/* Projekt na 30 dní (19. 7. - 18. 8.), dokončený 14. 8. Kolečko dní se má
   v ten moment zastavit na 26 a nepočítat dál k termínu. */
describe("kolečko dní", () => {
  const DONE_DAY = "2026-08-14";
  const AFTER = "2026-08-20";

  const finished = () => {
    const { state, projectId } = withProject(30);
    const r = createTask(state, projectId, { name: "a", target: 10, current: 4 }, TODAY);
    return { state: setTaskCurrent(r.state, r.task.id, 10, DONE_DAY), projectId };
  };

  it("rozdělaný projekt ukazuje postup k termínu", () => {
    const { state, projectId } = withProject(30);
    const s = createTask(state, projectId, { name: "a", target: 100, current: 60 }, TODAY).state;

    const ring = dayRing(projectStats(s, projectId, TODAY)!);
    expect(ring.days).toBe(18);
    expect(ring.total).toBe(30);
    expect(Math.round(ring.value)).toBe(60);
  });

  it("na 100 % je prstenec plný a jmenovatel zmizí", () => {
    const { state, projectId } = finished();

    const ring = dayRing(projectStats(state, projectId, DONE_DAY)!);
    expect(ring.value).toBe(100);
    expect(ring.days).toBe(26); // 19. 7. -> 14. 8.
    expect(ring.total).toBe(null);
  });

  it("počet dní se dál nezvyšuje, i když čas běží", () => {
    const { state, projectId } = finished();

    expect(dayRing(projectStats(state, projectId, AFTER)!).days).toBe(26);
    expect(projectStats(state, projectId, AFTER)!.daysElapsed).toBe(32);
  });

  it("po pádu pod stovku a návratu platí pozdější dokončení", () => {
    const { state, projectId } = finished();
    const taskId = state.tasks[0].id;
    const reopened = setTaskCurrent(state, taskId, 5, "2026-08-16");
    const again = setTaskCurrent(reopened, taskId, 10, "2026-08-18");

    const ring = dayRing(projectStats(again, projectId, AFTER)!);
    expect(ring.value).toBe(100);
    expect(ring.days).toBe(30); // 19. 7. -> 18. 8.
  });

  it("bez deadlinu drží nedokončený projekt počet dní bez jmenovatele", () => {
    const { state, projectId } = withProject(null);
    const s = createTask(state, projectId, { name: "a", target: 10, current: 1 }, TODAY).state;

    const ring = dayRing(projectStats(s, projectId, TODAY)!);
    expect(ring.days).toBe(18);
    expect(ring.total).toBe(null);
  });
});

describe("tempo proti kalendáři", () => {
  /* Projekt běží 19. 7. - 18. 8. (30 dní), dnes je 6. 8. = 18. den.
     Očekávaný postup je tedy 60 %; pásmo ±5 bodů kolem něj se nebarví. */
  const paceAt = (current: number, deadlineOffset: number | null = 30) => {
    const { state, projectId } = withProject(deadlineOffset);
    const s = createTask(state, projectId, { name: "a", target: 100, current }, TODAY).state;
    return pace(projectStats(s, projectId, TODAY)!);
  };

  it("bez deadlinu se tempo neřeší", () => {
    expect(paceAt(10, null)).toBe("none");
  });

  it("na plánu i v pásmu kolem něj mlčí", () => {
    expect(paceAt(60)).toBe("none");
    expect(paceAt(56)).toBe("none");
    expect(paceAt(64)).toBe("none");
  });

  it("pozná náskok i skluz", () => {
    expect(paceAt(80)).toBe("ahead");
    expect(paceAt(20)).toBe("behind");
  });

  it("hotový projekt je hotový, i když se k tomu došlo pozdě", () => {
    const { state, project } = createProject(
      EMPTY_STATE,
      { name: "pozdní", startDate: "2026-07-01", deadline: "2026-08-01" },
      TODAY,
    );
    const s = createTask(state, project.id, { name: "a", target: 10, current: 10 }, TODAY).state;

    expect(pace(projectStats(s, project.id, TODAY)!)).toBe("done");
  });

  it("po termínu a nedodělaný je pozdě", () => {
    const { state, project } = createProject(
      EMPTY_STATE,
      { name: "pozdní", startDate: "2026-07-01", deadline: "2026-08-01" },
      TODAY,
    );
    const s = createTask(state, project.id, { name: "a", target: 10, current: 1 }, TODAY).state;

    expect(pace(projectStats(s, project.id, TODAY)!)).toBe("late");
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

describe("celá čísla v úkolech", () => {
  it("zakládání zaokrouhlí cíl, hodnotu, krok i váhu", () => {
    const { state, projectId } = withProject();
    const r = createTask(
      state,
      projectId,
      { name: "a", target: 20.6, current: 13.6, step: 2.4, weight: 1.5 },
      TODAY,
    );

    expect(r.task.target).toBe(21);
    expect(r.task.current).toBe(14);
    expect(r.task.step).toBe(2);
    expect(r.task.weight).toBe(2);
  });

  it("posuvník ani ruční zápis desetinnou hodnotu neuloží", () => {
    const { state, projectId } = withProject();
    const r = createTask(state, projectId, { name: "a", target: 20 }, TODAY);
    const after = setTaskCurrent(r.state, r.task.id, 13.6, TODAY);

    expect(tasksOfProject(after, projectId)[0].current).toBe(14);
  });

  it("cíl pod jedničku nebo nesmysl spadne na 1", () => {
    const { state, projectId } = withProject();
    const r = createTask(state, projectId, { name: "a", target: 0.2 }, TODAY);

    expect(r.task.target).toBe(1);
    expect(isBinaryTask(r.state, r.task)).toBe(true);
  });

  it("úkol s podúkoly zaškrtávátko není - řídí ho podúkoly", () => {
    const { state, projectId } = withProject();
    const parent = createTask(state, projectId, { name: "p", target: 1 }, TODAY);
    const s = createTask(
      parent.state,
      projectId,
      { name: "c", target: 1, parentId: parent.task.id },
      TODAY,
    ).state;

    expect(isBinaryTask(s, taskById(s, parent.task.id)!)).toBe(false);
    expect(subtaskCounts(s, parent.task.id)).toEqual({ done: 0, total: 1 });
  });
});

describe("ruční pořadí přetažením", () => {
  function threeProjects() {
    let s = EMPTY_STATE;
    for (const name of ["a", "b", "c"]) {
      s = createProject(s, { name, startDate: "2026-07-19" }, TODAY).state;
    }
    return s;
  }

  const names = (s: MicroWinsState) => sortProjects(s, s.projects, "custom").map((p) => p.name);

  it("projekt přetažený na konec se tam uloží", () => {
    const s = threeProjects();
    const ids = sortProjects(s, s.projects, "custom").map((p) => p.id);
    const after = reorderProjects(s, [ids[1], ids[2], ids[0]]);

    expect(names(after)).toEqual(["b", "c", "a"]);
    expect(after.projects.map((p) => p.order).sort()).toEqual([0, 1, 2]);
  });

  it("skryté projekty zůstanou na svých místech", () => {
    const s = threeProjects();
    const ids = sortProjects(s, s.projects, "custom").map((p) => p.id);
    // Vidět jsou jen "a" a "c" (filtr schoval "b"), prohodí se mezi sebou.
    const after = reorderProjects(s, [ids[2], ids[0]]);

    expect(names(after)).toEqual(["c", "b", "a"]);
  });

  it("úkoly se přetahují jen mezi sourozenci", () => {
    const { state, projectId } = withProject();
    let s = createTask(state, projectId, { name: "první", target: 1 }, TODAY).state;
    s = createTask(s, projectId, { name: "druhý", target: 1 }, TODAY).state;
    const parent = tasksOfProject(s, projectId)[0];
    s = createTask(s, projectId, { name: "pod", target: 1, parentId: parent.id }, TODAY).state;

    const top = tasksOfProject(s, projectId).map((t) => t.id);
    const after = reorderTasks(s, [top[1], top[0]]);

    expect(tasksOfProject(after, projectId).map((t) => t.name)).toEqual(["druhý", "první"]);
    // Podúkol zůstal pod svým rodičem a nezamíchal se do horní úrovně.
    expect(subtasksOf(after, parent.id).map((t) => t.name)).toEqual(["pod"]);
  });

  it("neznámá id pořadí nerozhází", () => {
    const s = threeProjects();
    expect(names(reorderProjects(s, ["nic", "taky nic"]))).toEqual(["a", "b", "c"]);
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
