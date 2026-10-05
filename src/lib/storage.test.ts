import { describe, expect, it } from "vitest";
import { parseState } from "./storage";

/**
 * Uložený stav v telefonu je starší než appka, která ho čte. Zrušené klíče
 * (PushWiny, `pushExempt` u složek) v něm ještě jsou a nesmí shodit start ani
 * se protlačit zpátky na disk.
 */
describe("čtení staršího uloženého stavu", () => {
  const legacy = JSON.stringify({
    version: 5,
    nodes: [
      {
        id: "n1",
        parentId: null,
        kind: "category",
        name: "Business",
        createdAt: "2026-01-01T00:00:00.000Z",
        pushExempt: true,
      },
    ],
    entries: [],
    microwins: [],
    pushWins: [
      { id: "p1", week: "2026-08-10", kind: "burst", difficulty: "easy", target: 5, nodeId: null },
    ],
    projects: [],
    tasks: [],
    milestones: [],
    snapshots: [],
    taskSnapshots: [],
    todos: [],
  });

  it("stav se načte a strom zůstane", () => {
    const state = parseState(legacy);

    expect(state).not.toBe(null);
    expect(state!.nodes).toHaveLength(1);
    expect(state!.nodes[0].name).toBe("Business");
  });

  it("zrušené klíče se zahodí, ne přenesou", () => {
    const state = parseState(legacy)!;

    expect("pushWins" in state).toBe(false);
    expect("pushExempt" in state.nodes[0]).toBe(false);
    expect(JSON.stringify(state)).not.toContain("push");
  });
});

/**
 * Do v5 se obsah složky řadil až při vykreslení (druh, pak datum vzniku).
 * Teď rozhoduje pořadí v poli, takže se stará data musí jednou srovnat -
 * jinak by se uživateli po aktualizaci strom zamíchal. Novějším datům se
 * nesahá, jsou v nich ruční přesuny.
 */
describe("migrace pořadí uzlů", () => {
  const node = (id: string, kind: string, createdAt: string) => ({
    id,
    parentId: null,
    kind,
    name: id,
    createdAt,
  });

  // v poli naschvál obráceně, než se to do v5 zobrazovalo
  const nodes = [
    node("once", "once", "2026-01-01T00:00:00.000Z"),
    node("check", "check", "2026-01-02T00:00:00.000Z"),
    node("metric", "metric", "2026-01-03T00:00:00.000Z"),
    node("cat", "category", "2026-01-04T00:00:00.000Z"),
  ];

  const stored = (version: number) =>
    JSON.stringify({ version, nodes, entries: [], microwins: [], todos: [] });

  it("stará data se srovnají do pořadí, které uživatel viděl", () => {
    const state = parseState(stored(5));

    expect(state!.nodes.map((n) => n.id)).toEqual(["cat", "metric", "check", "once"]);
  });

  it("data z nové verze si drží ruční pořadí", () => {
    const state = parseState(stored(6));

    expect(state!.nodes.map((n) => n.id)).toEqual(["once", "check", "metric", "cat"]);
  });
});

describe("buňky mapy atomů v uloženém stavu", () => {
  const task = (id: string, extra: Record<string, unknown>) => ({
    id,
    projectId: "p",
    parentId: null,
    name: id,
    icon: "📝",
    target: 1,
    current: 0,
    step: 1,
    weight: 1,
    dueDate: null,
    milestoneId: null,
    description: "",
    order: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    completedAt: null,
    ...extra,
  });
  const stored = JSON.stringify({
    version: 6,
    nodes: [],
    entries: [],
    microwins: [],
    todos: [],
    tasks: [
      task("ok", { tracker: "count", mapOffset: { x: 10, y: -4 } }),
      task("bad", { tracker: "slider", mapOffset: { x: "vlevo", y: 2 } }),
    ],
  });

  it("platná volba a posun projdou, nesmysl zmizí i s klíčem", () => {
    const state = parseState(stored)!;
    const [ok, bad] = state.tasks;

    expect(ok.tracker).toBe("count");
    expect(ok.mapOffset).toEqual({ x: 10, y: -4 });
    expect("tracker" in bad).toBe(false);
    expect("mapOffset" in bad).toBe(false);
  });
});

describe("zdroj postupu úkolu", () => {
  const withTask = (progressFrom: unknown) =>
    JSON.stringify({
      version: 8,
      nodes: [],
      entries: [],
      projects: [{ id: "p", name: "P", icon: "📁", startDate: "2026-09-01", deadline: null, description: "", order: 0, createdAt: "2026-09-01T00:00:00.000Z", archivedAt: null }],
      tasks: [{ id: "t", projectId: "p", parentId: null, name: "Kliky", icon: "💪", target: 250, current: 50, step: 1, weight: 1, dueDate: null, milestoneId: null, description: "", order: 0, createdAt: "2026-09-01T00:00:00.000Z", completedAt: null, progressFrom }],
    });

  it("platná volba se načte", () => {
    expect(parseState(withTask("both"))!.tasks[0].progressFrom).toBe("both");
  });

  /* Poškozená nebo budoucí hodnota nesmí úkol rozbít - spadne na výchozí. */
  it("neznámá hodnota zmizí úplně, ne jako undefined", () => {
    const task = parseState(withTask("napul"))!.tasks[0];
    expect("progressFrom" in task).toBe(false);
  });
});

/**
 * Přenos zápisu z mřížky přes „Nestihl jsem" přišel až později. Bez něj by
 * se přenesený zápis po restartu appky znovu nabízel - a nesmysl v poli nesmí
 * zápis schovat navždy.
 */
describe("přenos časového bloku", () => {
  const block = (carriedTo: unknown) =>
    JSON.stringify({
      version: 8,
      nodes: [],
      entries: [],
      timeBlocks: [
        {
          id: "b1",
          date: "2026-10-04",
          start: 600,
          duration: 30,
          title: "Nafotit Lego",
          todoId: null,
          taskId: null,
          priorityId: null,
          createdAt: "2026-10-04T08:00:00.000Z",
          doneAt: null,
          carriedTo,
        },
      ],
    });

  it("platný den se načte, nesmysl i chybějící pole znamenají „ještě visí“", () => {
    expect(parseState(block("2026-10-05"))!.timeBlocks[0].carriedTo).toBe("2026-10-05");
    expect(parseState(block("včera"))!.timeBlocks[0].carriedTo ?? null).toBe(null);
    expect("carriedTo" in parseState(block(undefined))!.timeBlocks[0]).toBe(false);
  });
});
