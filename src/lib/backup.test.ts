import { describe, expect, it } from "vitest";
import { addCategory, addCheck, addMetric, addOnce, toggleCheck } from "./actions";
import { parseBackup, serializeBackup } from "./backup";
import { createProject, createTask } from "./project-actions";
import { EMPTY_STATE, type MicroWinsState } from "./types";

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

  it("přenese i nastavení zobrazení", () => {
    const raw = serializeBackup(fullState());
    const withPrefs = JSON.parse(raw);
    withPrefs.settings = { theme: "light", prefs: { winsView: "focus", accent: "lime" } };

    const restored = parseBackup(JSON.stringify(withPrefs))!;
    expect(restored.settings.theme).toBe("light");
    expect(restored.settings.prefs).toEqual({ winsView: "focus", accent: "lime" });
  });

  it("nesmyslné nastavení v záloze spadne na výchozí", () => {
    const withJunk = JSON.parse(serializeBackup(fullState()));
    withJunk.settings = { theme: "duhove", prefs: { winsView: "neco", accent: "duhova" } };

    const restored = parseBackup(JSON.stringify(withJunk))!;
    expect(restored.settings.theme).toBeUndefined();
    expect(restored.settings.prefs).toEqual({ winsView: "compact", accent: "emerald" });
  });

  it("záloha nese formát a verzi, aby šla poznat", () => {
    const parsed = JSON.parse(serializeBackup(fullState()));

    expect(parsed.format).toBe("microwins-backup");
    expect(parsed.backupVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
  });
});
