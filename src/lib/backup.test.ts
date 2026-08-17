import { describe, expect, it } from "vitest";
import { addCategory, addCheck, addMetric, addOnce, toggleCheck } from "./actions";
import { parseBackup, serializeBackup } from "./backup";
import { DEFAULT_PREFS } from "./prefs";
import { createProject, createTask } from "./project-actions";
import { EMPTY_STATE, STATE_VERSION, type MicroWinsState } from "./types";

const TODAY = "2026-08-08";

/** Stav se vším, co appka umí - právě tohle musí záloha přenést. */
function fullState(): MicroWinsState {
  const cat = addCategory(EMPTY_STATE, null, "Business");
  const metric = addMetric(cat.state, cat.node.id, { name: "X cold calls za den", unit: "ks" });
  const check = addCheck(metric.state, cat.node.id, "Ranní protažení");
  const checked = toggleCheck(check.state, check.node.id, TODAY, TODAY);
  const once = addOnce(checked.state, cat.node.id, { name: "První nabídka", note: "48 000" }, TODAY);

  const project = createProject(once.state, { name: "10K kliků", icon: "🖱️" }, TODAY);
  const task = createTask(project.state, project.project.id, { name: "kliky", target: 2000 }, TODAY);
  return task.state;
}

describe("záloha", () => {
  it("přenese strom, záznamy, microwiny i projekty", () => {
    const state = fullState();
    const restored = parseBackup(serializeBackup(state));

    expect(restored).not.toBeNull();
    expect(restored!.state.nodes).toHaveLength(state.nodes.length);
    expect(restored!.state.entries).toHaveLength(state.entries.length);
    expect(restored!.state.microwins).toHaveLength(state.microwins.length);
    expect(restored!.state.projects).toHaveLength(1);
    expect(restored!.state.tasks).toHaveLength(1);
  });

  it("zachová všechny tři druhy winů i jejich detaily", () => {
    const state = fullState();
    const restored = parseBackup(serializeBackup(state))!.state;

    const kinds = restored.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(["category", "check", "metric", "once"]);

    const metric = restored.nodes.find((n) => n.kind === "metric")!;
    expect(metric.unit).toBe("ks");
    expect(restored.entries.find((e) => e.note === "48 000")).toBeDefined();
  });

  it("načte i starší holý export bez obálky", () => {
    const state = fullState();
    const restored = parseBackup(JSON.stringify(state));

    expect(restored).not.toBeNull();
    expect(restored!.state.nodes).toHaveLength(state.nodes.length);
    expect(restored!.settings).toEqual({});
  });

  it("cizí nebo poškozený JSON odmítne", () => {
    expect(parseBackup("{ tohle není json")).toBeNull();
    expect(parseBackup('{"neco":"jineho"}')).toBeNull();
    expect(parseBackup("[]")).toBeNull();
  });

  it("přenese i nastavení vzhledu", () => {
    const raw = serializeBackup(fullState());
    const withTheme = JSON.parse(raw);
    withTheme.settings = { theme: "light" };

    const restored = parseBackup(JSON.stringify(withTheme))!;
    expect(restored.settings.theme).toBe("light");
  });

  it("nesmyslné nastavení v záloze se zahodí", () => {
    const withJunk = JSON.parse(serializeBackup(fullState()));
    withJunk.settings = { theme: "duhove" };

    const restored = parseBackup(JSON.stringify(withJunk))!;
    expect(restored.settings.theme).toBeUndefined();
  });

  /* Starší zálohy nesou volby, které mezitím zmizely (pohled na winy) nebo se
     přejmenovaly (pět odstínů zelené na jednu). Nesmí kvůli tomu spadnout ani
     se protlačit dál - neznámá volba spadne na výchozí. */
  it("záloha ze starší verze se přečte, zrušené volby se zahodí", () => {
    const old = JSON.parse(serializeBackup(fullState()));
    old.settings = { theme: "dark", prefs: { winsView: "focus", accent: "sage" } };

    const restored = parseBackup(JSON.stringify(old))!;
    expect(restored.settings.theme).toBe("dark");
    expect(restored.settings.prefs).toEqual(DEFAULT_PREFS);
    expect(restored.state.microwins.length).toBeGreaterThan(0);
  });

  it("přenese vlastní volby zobrazení", () => {
    const raw = JSON.parse(serializeBackup(fullState()));
    raw.settings = {
      prefs: {
        accent: "white",
        overview: "pulse",
        addons: { todo: false },
        tabOrder: ["projects", "overview", "todo"],
      },
    };

    const restored = parseBackup(JSON.stringify(raw))!;
    expect(restored.settings.prefs).toEqual({
      ...DEFAULT_PREFS,
      accent: "white",
      overview: "pulse",
      addons: { todo: false },
      tabOrder: ["projects", "overview", "todo"],
    });
  });

  it("záloha nese formát a verzi, aby šla poznat", () => {
    const parsed = JSON.parse(serializeBackup(fullState()));

    expect(parsed.format).toBe("microwins-backup");
    expect(parsed.backupVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
  });
});

/**
 * Stav, ve kterém je vyplněné úplně všechno - každá kolekce i každé nepovinné
 * pole. Ručně psaný schválně: kdyby se stavěl akcemi, otestoval by jen to, co
 * appka zrovna umí naklikat, a nová kolekce by se do zálohy mohla nedostat,
 * aniž by o tom kterýkoli test věděl.
 */
function maximalState(): MicroWinsState {
  return {
    version: STATE_VERSION,
    nodes: [
      { id: "n_cat", parentId: null, kind: "category", name: "Business", icon: "lucide:Briefcase", createdAt: "2026-01-01T10:00:00.000Z" },
      { id: "n_sub", parentId: "n_cat", kind: "category", name: "cold calls", icon: "📞", createdAt: "2026-01-02T10:00:00.000Z" },
      { id: "n_metric", parentId: "n_sub", kind: "metric", name: "X cold calls", unit: "ks", aggregation: "max", createdAt: "2026-01-03T10:00:00.000Z" },
      { id: "n_check", parentId: "n_cat", kind: "check", name: "Ranní protažení", createdAt: "2026-01-04T10:00:00.000Z" },
      { id: "n_once", parentId: "n_cat", kind: "once", name: "První nabídka", createdAt: "2026-01-05T10:00:00.000Z" },
    ],
    entries: [
      { id: "e_1", metricId: "n_metric", date: "2026-01-10", value: 2.5, note: "půlka dne", createdAt: "2026-01-10T10:00:00.000Z", backdated: false },
      { id: "e_2", metricId: "n_metric", date: "2026-01-11", value: 7, createdAt: "2026-01-12T10:00:00.000Z", backdated: true },
      { id: "e_3", metricId: "n_check", date: "2026-01-11", value: 1, createdAt: "2026-01-11T10:00:00.000Z", backdated: false },
      { id: "e_4", metricId: "n_once", date: "2026-01-12", value: 1, note: "48 000", createdAt: "2026-01-12T10:00:00.000Z", backdated: false },
    ],
    microwins: [
      { id: "w_1", metricId: "n_metric", date: "2026-01-10", value: 2.5, previousRecord: 0, firstEver: true, createdAt: "2026-01-10T10:00:00.000Z" },
      { id: "w_2", metricId: "n_metric", date: "2026-01-11", value: 7, previousRecord: 2.5, firstEver: false, createdAt: "2026-01-11T10:00:00.000Z" },
    ],
    projects: [
      { id: "p_1", name: "10K kliků", icon: "🖱️", startDate: "2026-01-01", deadline: "2026-12-31", description: "dlouhý popis", order: 0, createdAt: "2026-01-01T10:00:00.000Z", archivedAt: null },
      { id: "p_2", name: "Archiv", icon: "📦", startDate: "2025-01-01", deadline: null, description: "", order: 1, createdAt: "2025-01-01T10:00:00.000Z", archivedAt: "2026-02-01T10:00:00.000Z" },
    ],
    tasks: [
      { id: "t_1", projectId: "p_1", parentId: null, name: "kliky", icon: "💪", target: 2000, current: 630, unit: "ks", step: 10, weight: 3, dueDate: "2026-06-30", milestoneId: "m_1", description: "popis úkolu", order: 0, createdAt: "2026-01-01T10:00:00.000Z", completedAt: null },
      { id: "t_2", projectId: "p_1", parentId: "t_1", name: "podúkol", icon: "🔧", target: 10, current: 10, step: 1, weight: 0, dueDate: null, milestoneId: null, description: "", order: 1, createdAt: "2026-01-02T10:00:00.000Z", completedAt: "2026-03-01T10:00:00.000Z" },
    ],
    milestones: [
      { id: "m_1", projectId: "p_1", name: "První tisíc", date: "2026-06-01", createdAt: "2026-01-01T10:00:00.000Z", doneAt: "2026-05-20T10:00:00.000Z" },
      { id: "m_2", projectId: "p_1", name: "Bez data", date: null, createdAt: "2026-01-01T10:00:00.000Z", doneAt: null },
    ],
    snapshots: [
      { projectId: "p_1", date: "2026-01-10", percent: 12.5 },
      { projectId: "p_1", date: "2026-01-11", percent: 20 },
    ],
    taskSnapshots: [
      { taskId: "t_1", date: "2026-01-10", percent: 31.5 },
      { taskId: "t_2", date: "2026-01-11", percent: 100 },
    ],
    todos: [
      { id: "td_1", text: "otevřená položka", createdAt: "2026-01-10T10:00:00.000Z", doneAt: null, order: 0 },
      { id: "td_2", text: "odškrtnutá položka", createdAt: "2026-01-10T10:00:00.000Z", doneAt: "2026-01-10T12:00:00.000Z", order: 1 },
    ],
  };
}

describe("záloha nese úplně všechno", () => {
  it("stav se vším všudy projde zálohou beze změny", () => {
    const state = maximalState();
    const restored = parseBackup(serializeBackup(state));

    expect(restored).not.toBeNull();
    expect(restored!.state).toEqual(state);
  });

  /* Pojistka proti tiché ztrátě celé kolekce: kdyby v `parseState` chyběl
     jeden řádek, deep equal výš spadne na nečitelném diffu - tohle řekne
     rovnou které pole. */
  it("žádná kolekce se cestou neztratí ani neprořídne", () => {
    const state = maximalState();
    const out = parseBackup(serializeBackup(state))!.state;

    for (const key of [
      "nodes",
      "entries",
      "microwins",
      "projects",
      "tasks",
      "milestones",
      "snapshots",
      "taskSnapshots",
      "todos",
    ] as const) {
      expect({ [key]: out[key].length }).toEqual({ [key]: state[key].length });
    }
  });

  it("nepovinná pole přežijí i s nulou, prázdným textem a nullem", () => {
    const out = parseBackup(serializeBackup(maximalState()))!.state;

    // 0 je platná váha (úkol mimo procenta) - nesmí spadnout na výchozí 1.
    expect(out.tasks.find((t) => t.id === "t_2")!.weight).toBe(0);
    expect(out.tasks.find((t) => t.id === "t_1")!.milestoneId).toBe("m_1");
    expect(out.nodes.find((n) => n.id === "n_metric")!.aggregation).toBe("max");
    expect(out.projects.find((p) => p.id === "p_2")!.archivedAt).not.toBeNull();
    expect(out.milestones.find((m) => m.id === "m_1")!.doneAt).not.toBeNull();
    expect(out.entries.find((e) => e.id === "e_2")!.backdated).toBe(true);
    // Odškrtnuté ToDo se maže samo až po TTL - do zálohy patří i tak.
    expect(out.todos.find((t) => t.id === "td_2")!.doneAt).not.toBeNull();
  });
});
