import { describe, expect, it } from "vitest";
import { addCategory, addMetric, reorderNodes } from "./actions";
import { createProject, createTask, reorderProjects, updateProject } from "./project-actions";
import { BRAIN_DUMP_MAX, setBrainDump } from "./timebox";
import { addTodo, deleteTodo, renameTodo } from "./todos";
import {
  applyRecords,
  diffStates,
  fromRecords,
  isEmptyState,
  mergeDaySheet,
  NODE_ORDER_KIND,
  recordFromState,
  toRecords,
  type SyncRecord,
} from "./sync";
import { EMPTY_STATE, type DaySheet, type MicroWinsState } from "./types";

const TODAY = "2026-09-30";

function sample(): MicroWinsState {
  const a = addCategory(EMPTY_STATE, null, "Business");
  const b = addCategory(a.state, null, "Fitness");
  const m = addMetric(b.state, a.node.id, { name: "X hovorů za den" });
  const p = createProject(m.state, { name: "Web" }, TODAY);
  const t = createTask(p.state, p.project.id, { name: "Doména", target: 1 }, TODAY);
  const todo = addTodo(t.state, "koupit kafe").state;
  return setBrainDump(todo, TODAY, "nápad");
}

describe("stav jako záznamy", () => {
  it("projde tam a zpátky beze ztráty, i s pořadím ve stromu", () => {
    const state = sample();
    const back = fromRecords(toRecords(state));

    expect(back.nodes.map((n) => n.id)).toEqual(state.nodes.map((n) => n.id));
    expect(back.projects).toEqual(state.projects);
    expect(back.tasks).toEqual(state.tasks);
    expect(back.todos).toEqual(state.todos);
    expect(back.daySheets).toEqual(state.daySheets);
    expect(back.snapshots).toEqual(state.snapshots);
  });

  it("prázdný stav se pozná", () => {
    expect(isEmptyState(EMPTY_STATE)).toBe(true);
    expect(isEmptyState(sample())).toBe(false);
  });
});

describe("rozdíl dvou stavů", () => {
  const base = sample();

  it("beze změny nic", () => {
    expect(diffStates(base, base)).toEqual([]);
    expect(diffStates(base, { ...base })).toEqual([]);
  });

  it("přidaná, změněná i smazaná položka", () => {
    const added = addTodo(base, "druhá").state;
    const renamed = renameTodo(added, base.todos[0].id, "koupit čaj");
    const diff = diffStates(added, renamed);

    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ kind: "todos", key: base.todos[0].id });

    const removed = deleteTodo(renamed, base.todos[0].id);
    expect(diffStates(renamed, removed)).toEqual([
      { kind: "todos", key: base.todos[0].id, data: null },
    ]);
  });

  /* Přečíslování pořadí dělá z každého projektu nový objekt. Kdyby se to
     počítalo za změnu, šly by na server všechny projekty při každém tahu. */
  it("nový objekt se stejným obsahem změna není", () => {
    const copy = { ...base, projects: base.projects.map((p) => ({ ...p })) };
    expect(diffStates(base, copy)).toEqual([]);
  });

  it("změna jednoho projektu pošle jen ten jeden", () => {
    const two = createProject(base, { name: "Druhý" }, TODAY).state;
    const edited = updateProject(two, base.projects[0].id, { name: "Web 2" });
    const diff = diffStates(two, edited).filter((r) => r.kind === "projects");

    expect(diff.map((r) => r.key)).toEqual([base.projects[0].id]);
  });

  it("přetažení projektu jde přes jeho order", () => {
    const two = createProject(base, { name: "Druhý" }, TODAY).state;
    const ids = two.projects.map((p) => p.id);
    const moved = reorderProjects(two, [ids[1], ids[0]]);

    expect(diffStates(two, moved).filter((r) => r.kind === "projects")).toHaveLength(2);
  });

  /* Pořadí ve stromu je pořadí v poli - uzly samy se přetažením nemění. */
  it("přetažení ve stromu pošle nové pořadí uzlů", () => {
    const roots = base.nodes.filter((n) => n.parentId === null).map((n) => n.id);
    const moved = reorderNodes(base, [...roots].reverse());
    const diff = diffStates(base, moved);

    expect(diff).toEqual([
      { kind: NODE_ORDER_KIND, key: "nodes", data: moved.nodes.map((n) => n.id) },
    ]);
  });
});

describe("záznamy z účtu do stavu", () => {
  const base = sample();

  it("nový přibude, změněný se vymění na místě, náhrobek smaže", () => {
    const todo = base.todos[0];
    const records: SyncRecord[] = [
      { kind: "todos", key: todo.id, data: { ...todo, text: "z tabletu" } },
      { kind: "todos", key: "tdo_novy", data: { ...todo, id: "tdo_novy", text: "nová", order: 1 } },
      { kind: "projects", key: base.projects[0].id, data: null },
    ];
    const next = applyRecords(base, records);

    expect(next.todos.map((t) => t.text)).toEqual(["z tabletu", "nová"]);
    expect(next.projects).toEqual([]);
  });

  it("stejný obsah nic nezmění a vrátí tentýž stav", () => {
    const same = applyRecords(base, toRecords(base));
    expect(same).toBe(base);
  });

  it("odmítnutý záznam se přeskočí - telefon má novější změnu", () => {
    const todo = base.todos[0];
    const next = applyRecords(
      base,
      [{ kind: "todos", key: todo.id, data: { ...todo, text: "starší" } }],
      () => false,
    );
    expect(next).toBe(base);
  });

  it("pořadí ve stromu z jiného zařízení se převezme", () => {
    const ids = base.nodes.map((n) => n.id);
    const next = applyRecords(base, [
      { kind: NODE_ORDER_KIND, key: "nodes", data: [...ids].reverse() },
    ]);
    expect(next.nodes.map((n) => n.id)).toEqual([...ids].reverse());
  });

  it("neznámý druh záznamu z novější verze appky se ignoruje", () => {
    const next = applyRecords(base, [{ kind: "budouci" as never, key: "x", data: { a: 1 } }]);
    expect(next).toBe(base);
  });
});

describe("co odeslat", () => {
  it("aktuální podoba záznamu, nebo náhrobek", () => {
    const base = sample();
    const todo = base.todos[0];

    expect(recordFromState(base, "todos", todo.id)).toEqual({ kind: "todos", key: todo.id, data: todo });
    expect(recordFromState(base, "todos", "neni")).toEqual({ kind: "todos", key: "neni", data: null });
    expect(recordFromState(base, "daySheets", TODAY)?.data).toEqual(base.daySheets[0]);
    expect(recordFromState(base, NODE_ORDER_KIND, "nodes")?.data).toEqual(base.nodes.map((n) => n.id));
  });
});

describe("slévání listu time boxu", () => {
  function sheet(brainDump: string, priorities: string[] = []): DaySheet {
    return {
      date: TODAY,
      priorities: [0, 1, 2].map((i) => ({ text: priorities[i] ?? "", done: false })),
      brainDump,
    };
  }

  it("připíše jen řádky, které v novější verzi nejsou", () => {
    const merged = mergeDaySheet(sheet(["a", "b", ""].join("\n")), sheet(["b", "", "  c", "a"].join("\n")));
    expect(merged?.brainDump).toBe(["a", "b", "  c"].join("\n"));
  });

  it("prázdnou prioritu doplní, obsazenou nechá a tu druhou připíše", () => {
    const merged = mergeDaySheet(sheet("", ["web", ""]), sheet("", ["faktury", "trénink"]));
    expect(merged?.priorities.map((p) => p.text)).toEqual(["web", "trénink", ""]);
    expect(merged?.brainDump).toBe("• faktury");
  });

  it("stejná priorita na obou se nepřipisuje", () => {
    const newer = sheet("", ["web"]);
    expect(mergeDaySheet(newer, sheet("", ["web "]))).toEqual(newer);
  });

  it("přetečení limitu vrací null", () => {
    expect(mergeDaySheet(sheet("x".repeat(BRAIN_DUMP_MAX)), sheet("y"))).toBeNull();
  });
});
