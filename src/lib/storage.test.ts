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
