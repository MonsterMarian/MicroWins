import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCategory, addEntry, addMetric } from "./actions";
import { applySeed } from "./seed-import";
import { SEED_STATE } from "./seed-import-data";
import { createProject } from "./project-actions";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const TODAY = "2026-08-10";

/** localStorage v node prostředí není, seed si na něj sahá. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
});

/** Strom se dvěma winy - musí seed přežít bez jediné změny. */
function withTree(): MicroWinsState {
  const cat = addCategory(EMPTY_STATE, null, "Social");
  const metric = addMetric(cat.state, cat.node.id, { name: "X vystoupení za den" });
  return addEntry(metric.state, { metricId: metric.node.id, value: 1 }, TODAY).state;
}

describe("jednorázová zásilka projektů", () => {
  it("při prvním spuštění projekty přidá", () => {
    const res = applySeed(EMPTY_STATE);

    expect(res.added).toBe(SEED_STATE.projects.length);
    expect(res.state.projects).toHaveLength(SEED_STATE.projects.length);
    expect(res.state.tasks.length).toBe(SEED_STATE.tasks.length);
  });

  it("podruhé už neudělá nic - projekty se nezdvojí", () => {
    const first = applySeed(EMPTY_STATE);
    const second = applySeed(first.state);

    expect(second.added).toBe(0);
    expect(second.state).toBe(first.state);
    expect(second.state.projects).toHaveLength(SEED_STATE.projects.length);
  });

  it("stromu se ani nedotkne", () => {
    const before = withTree();
    const after = applySeed(before);

    expect(after.state.nodes).toBe(before.nodes);
    expect(after.state.entries).toBe(before.entries);
    expect(after.state.microwins).toBe(before.microwins);
    expect(after.added).toBeGreaterThan(0);
  });

  it("vlastní projekty uživatele zůstanou i s pořadím", () => {
    const mine = createProject(withTree(), { name: "Můj projekt" }, TODAY).state;
    const after = applySeed(mine);

    expect(after.state.projects[0].name).toBe("Můj projekt");
    expect(after.state.projects).toHaveLength(SEED_STATE.projects.length + 1);
    expect(after.state.projects.map((p) => p.order)).toEqual(
      after.state.projects.map((_, i) => i),
    );
  });

  it("když si uživatel data načetl ze souboru sám, seed se přeskočí", () => {
    // stejný název i start = poznáme, že už tam jsou
    const sample = SEED_STATE.projects[0];
    const existing = createProject(
      EMPTY_STATE,
      { name: sample.name, startDate: sample.startDate },
      TODAY,
    ).state;

    const after = applySeed(existing);
    expect(after.added).toBe(0);
    expect(after.state.projects).toHaveLength(1);
  });

  it("bez localStorage se o nic nepokouší", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("zakázáno");
      },
      setItem: () => {
        throw new Error("zakázáno");
      },
    } as unknown as Storage);

    const after = applySeed(EMPTY_STATE);
    expect(after.added).toBe(0);
    expect(after.state).toBe(EMPTY_STATE);
  });

  it("zásilka nese jen projekty, žádný strom", () => {
    expect(SEED_STATE.nodes).toEqual([]);
    expect(SEED_STATE.entries).toEqual([]);
    expect(SEED_STATE.microwins).toEqual([]);
    expect(SEED_STATE.projects.length).toBeGreaterThan(0);
  });
});
