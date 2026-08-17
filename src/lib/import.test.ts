import { describe, expect, it } from "vitest";
import { addCategory, addCheck, addEntry, addMetric, deleteEntry } from "./actions";
import { countState, hasScope, mergeState } from "./import";
import { createProject, createTask } from "./project-actions";
import { addTodo, toggleTodo } from "./todos";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const TODAY = "2026-08-10";

/** Stav se stromem i projekty - obě poloviny appky naráz. */
function stateWith({ tree, project }: { tree: string; project: string }): MicroWinsState {
  const cat = addCategory(EMPTY_STATE, null, tree);
  const metric = addMetric(cat.state, cat.node.id, { name: `X ${tree} za den` });
  const withEntry = addEntry(metric.state, { metricId: metric.node.id, value: 3 }, TODAY).state;
  const check = addCheck(withEntry, cat.node.id, `${tree} - protažení`);

  const prj = createProject(check.state, { name: project }, TODAY);
  const task = createTask(prj.state, prj.project.id, { name: `${project} - úkol`, target: 100, current: 40 }, TODAY);
  const sub = createTask(
    task.state,
    prj.project.id,
    { name: "podúkol", target: 1, parentId: task.task.id },
    TODAY,
  );
  return sub.state;
}

describe("počty ve stavu", () => {
  it("rozdělí strom a projekty", () => {
    const counts = countState(stateWith({ tree: "Business", project: "10K kliků" }));

    expect(counts.folders).toBe(1);
    expect(counts.wins).toBe(2); // metrika + check
    expect(counts.entries).toBe(1);
    expect(counts.microwins).toBe(1);
    expect(counts.projects).toBe(1);
    expect(counts.tasks).toBe(2); // úkol + podúkol
  });

  it("pozná, jestli záloha vůbec obsahuje požadovanou půlku", () => {
    const full = countState(stateWith({ tree: "Business", project: "10K kliků" }));
    const empty = countState(EMPTY_STATE);

    expect(hasScope(full, "projects")).toBe(true);
    expect(hasScope(full, "tree")).toBe(true);
    expect(hasScope(empty, "projects")).toBe(false);
    expect(hasScope(empty, "all")).toBe(false);
  });
});

describe("import jen projektů", () => {
  const current = stateWith({ tree: "Můj strom", project: "Můj projekt" });
  const incoming = stateWith({ tree: "Cizí strom", project: "Cizí projekt" });

  it("přidáním se strom vůbec nesáhne", () => {
    const merged = mergeState(current, incoming, "projects", "add");

    expect(merged.nodes).toBe(current.nodes);
    expect(merged.entries).toBe(current.entries);
    expect(merged.microwins).toBe(current.microwins);
    expect(merged.projects.map((p) => p.name)).toEqual(["Můj projekt", "Cizí projekt"]);
    expect(merged.tasks).toHaveLength(4);
  });

  it("nahrazením zmizí jen staré projekty, strom zůstává", () => {
    const merged = mergeState(current, incoming, "projects", "replace");

    expect(merged.nodes).toBe(current.nodes);
    expect(merged.projects.map((p) => p.name)).toEqual(["Cizí projekt"]);
    expect(merged.tasks).toHaveLength(2);
    // úkoly ukazují na přežívající projekt
    expect(new Set(merged.tasks.map((t) => t.projectId))).toEqual(
      new Set([merged.projects[0].id]),
    );
  });

  it("přidání přerazí id, takže se nic nepotká se stávajícími daty", () => {
    const merged = mergeState(current, current, "projects", "add");
    const ids = merged.projects.map((p) => p.id);
    const taskIds = merged.tasks.map((t) => t.id);

    expect(new Set(ids).size).toBe(2);
    expect(new Set(taskIds).size).toBe(4);
    // každý úkol visí na existujícím projektu
    for (const t of merged.tasks) expect(ids).toContain(t.projectId);
  });

  it("vazba podúkol -> rodič přežije přerazení id", () => {
    const merged = mergeState(EMPTY_STATE, incoming, "projects", "add");
    const parents = merged.tasks.filter((t) => t.parentId === null);
    const children = merged.tasks.filter((t) => t.parentId !== null);

    expect(parents).toHaveLength(1);
    expect(children).toHaveLength(1);
    expect(children[0].parentId).toBe(parents[0].id);
  });

  it("pořadí přidaných projektů navazuje, nepřekrývá se", () => {
    const merged = mergeState(current, incoming, "projects", "add");
    expect(merged.projects.map((p) => p.order)).toEqual([0, 1]);
  });

  /* Přetažení projektu přepisuje jen `order`, pole zůstává v pořadí vzniku.
     Kdyby se `order` při načtení počítalo z indexu, přišel by uživatel o ruční
     uspořádání pokaždé, když si obnoví zálohu. */
  it("ruční pořadí projektů přežije načtení, i když pole jede jinak", () => {
    const base = stateWith({ tree: "x", project: "První" });
    const two = createProject(base, { name: "Druhý" }, TODAY).state;
    const three = createProject(two, { name: "Třetí" }, TODAY).state;

    // Uživatel přetáhl "Třetí" úplně nahoru - pole se nehnulo, `order` ano.
    const shuffled: MicroWinsState = {
      ...three,
      projects: three.projects.map((p) =>
        p.name === "Třetí" ? { ...p, order: -1 } : p,
      ),
    };
    const byOrder = (s: MicroWinsState) =>
      [...s.projects].sort((a, b) => a.order - b.order).map((p) => p.name);

    expect(byOrder(shuffled)).toEqual(["Třetí", "První", "Druhý"]);
    expect(byOrder(mergeState(EMPTY_STATE, shuffled, "projects", "replace"))).toEqual([
      "Třetí",
      "První",
      "Druhý",
    ]);
    expect(byOrder(mergeState(EMPTY_STATE, shuffled, "projects", "add"))).toEqual([
      "Třetí",
      "První",
      "Druhý",
    ]);
  });

  it("ruční pořadí ToDo přežije načtení taky", () => {
    const base = addTodo(addTodo(EMPTY_STATE, "první").state, "druhá").state;
    const shuffled: MicroWinsState = {
      ...base,
      todos: base.todos.map((t) => (t.text === "druhá" ? { ...t, order: -1 } : t)),
    };
    const byOrder = (s: MicroWinsState) =>
      [...s.todos].sort((a, b) => a.order - b.order).map((t) => t.text);

    expect(byOrder(mergeState(EMPTY_STATE, shuffled, "projects", "replace"))).toEqual([
      "druhá",
      "první",
    ]);
  });
});

describe("ToDo v záloze", () => {
  const mine = addTodo(stateWith({ tree: "Můj strom", project: "Můj projekt" }), "moje").state;
  const theirs = addTodo(stateWith({ tree: "Cizí strom", project: "Cizí projekt" }), "cizí").state;

  it("jede s projektovou polovinou, ne se stromem", () => {
    expect(mergeState(mine, theirs, "tree", "add").todos).toBe(mine.todos);
    expect(mergeState(mine, theirs, "projects", "add").todos.map((t) => t.text)).toEqual([
      "moje",
      "cizí",
    ]);
  });

  it("nahrazením zbude jen seznam ze zálohy", () => {
    expect(mergeState(mine, theirs, "projects", "replace").todos.map((t) => t.text)).toEqual([
      "cizí",
    ]);
  });

  it("přidání přerazí id a posadí pořadí za stávající položky", () => {
    const merged = mergeState(mine, mine, "projects", "add");

    expect(new Set(merged.todos.map((t) => t.id)).size).toBe(2);
    expect(merged.todos.map((t) => t.order)).toEqual([0, 1]);
  });

  it("záloha se samotným seznamem se pozná jako projektová", () => {
    const onlyTodos = addTodo(EMPTY_STATE, "koupit mléko").state;
    const counts = countState(onlyTodos);

    expect(counts.todos).toBe(1);
    expect(hasScope(counts, "projects")).toBe(true);
    expect(hasScope(counts, "tree")).toBe(false);
  });

  it("odškrtnuté položky se do počtů neberou - mizí samy", () => {
    const base = addTodo(EMPTY_STATE, "hotová").state;
    const done = toggleTodo(base, base.todos[0].id);

    expect(countState(done).todos).toBe(0);
  });
});

describe("import jen stromu", () => {
  const current = stateWith({ tree: "Můj strom", project: "Můj projekt" });
  const incoming = stateWith({ tree: "Cizí strom", project: "Cizí projekt" });

  it("projekty zůstanou nedotčené", () => {
    const merged = mergeState(current, incoming, "tree", "add");

    expect(merged.projects).toBe(current.projects);
    expect(merged.tasks).toBe(current.tasks);
    expect(merged.snapshots).toBe(current.snapshots);
    expect(merged.nodes).toHaveLength(6);
  });

  it("záznamy a microwiny jdou s uzly", () => {
    const merged = mergeState(EMPTY_STATE, incoming, "tree", "add");
    const metricIds = new Set(merged.nodes.map((n) => n.id));

    expect(merged.entries).toHaveLength(1);
    expect(metricIds.has(merged.entries[0].metricId)).toBe(true);
    expect(metricIds.has(merged.microwins[0].metricId)).toBe(true);
  });

  /* Uzly i microwiny se při `add` přerážejí odjakživa, záznamy se na to
     zapomnělo. Dvakrát načtená stejná záloha tak vyrobila dva záznamy se
     stejným id - a `deleteEntry` maže podle id, takže smazání jednoho sebralo
     i ten druhý. */
  it("dvojí přidání téže zálohy nevyrobí dva záznamy se stejným id", () => {
    const once = mergeState(current, current, "tree", "add");
    const twice = mergeState(once, current, "tree", "add");
    const ids = twice.entries.map((e) => e.id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("smazání jednoho ze zdvojených záznamů nechá ten druhý být", () => {
    const merged = mergeState(current, current, "tree", "add");
    const doomed = merged.entries[0];
    const after = deleteEntry(merged, doomed.id, TODAY);

    expect(after.entries).toHaveLength(merged.entries.length - 1);
    expect(after.entries.some((e) => e.id === doomed.id)).toBe(false);
  });

  it("hierarchie složek přežije přerazení id", () => {
    const merged = mergeState(current, incoming, "tree", "add");
    const roots = merged.nodes.filter((n) => n.parentId === null);
    const ids = new Set(merged.nodes.map((n) => n.id));

    expect(roots.map((r) => r.name).sort()).toEqual(["Cizí strom", "Můj strom"]);
    for (const n of merged.nodes) {
      if (n.parentId) expect(ids.has(n.parentId)).toBe(true);
    }
  });
});

describe("import všeho", () => {
  it("nahrazení sedne na starou obnovu ze zálohy", () => {
    const current = stateWith({ tree: "Můj strom", project: "Můj projekt" });
    const incoming = stateWith({ tree: "Cizí strom", project: "Cizí projekt" });
    const merged = mergeState(current, incoming, "all", "replace");

    expect(merged.nodes).toEqual(incoming.nodes);
    expect(merged.projects).toEqual(
      incoming.projects.map((p, i) => ({ ...p, order: i })),
    );
    expect(merged.entries).toEqual(incoming.entries);
  });

  it("přidání spojí obě poloviny", () => {
    const current = stateWith({ tree: "Můj strom", project: "Můj projekt" });
    const incoming = stateWith({ tree: "Cizí strom", project: "Cizí projekt" });
    const merged = mergeState(current, incoming, "all", "add");

    expect(merged.nodes).toHaveLength(6);
    expect(merged.projects).toHaveLength(2);
    expect(merged.microwins).toHaveLength(2);
  });
});

describe("poškozená záloha", () => {
  it("úkol bez svého projektu se zahodí, nezůstane viset", () => {
    const incoming = stateWith({ tree: "x", project: "y" });
    const orphaned: MicroWinsState = {
      ...incoming,
      tasks: incoming.tasks.map((t) => ({ ...t, projectId: "neexistuje" })),
    };
    const merged = mergeState(EMPTY_STATE, orphaned, "projects", "add");

    expect(merged.projects).toHaveLength(1);
    expect(merged.tasks).toEqual([]);
  });

  it("uzel s chybějícím rodičem se přesune na kořen", () => {
    const incoming = stateWith({ tree: "x", project: "y" });
    const broken: MicroWinsState = {
      ...incoming,
      nodes: incoming.nodes.map((n) =>
        n.kind === "metric" ? { ...n, parentId: "neexistuje" } : n,
      ),
    };
    const merged = mergeState(EMPTY_STATE, broken, "tree", "add");
    const metric = merged.nodes.find((n) => n.kind === "metric")!;

    expect(metric.parentId).toBeNull();
    expect(merged.entries).toHaveLength(1);
  });

  it("dva otisky téhož dne a projektu se slijí do jednoho", () => {
    const incoming = stateWith({ tree: "x", project: "y" });
    const id = incoming.projects[0].id;
    const doubled: MicroWinsState = {
      ...incoming,
      snapshots: [
        { projectId: id, date: TODAY, percent: 10 },
        { projectId: id, date: TODAY, percent: 40 },
      ],
    };
    const merged = mergeState(EMPTY_STATE, doubled, "projects", "replace");

    expect(merged.snapshots).toHaveLength(1);
    expect(merged.snapshots[0].percent).toBe(40);
  });
});
