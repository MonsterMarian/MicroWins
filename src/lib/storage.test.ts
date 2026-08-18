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
