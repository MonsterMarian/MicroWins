import { describe, expect, it } from "vitest";
import {
  addCategory,
  addCheck,
  addEntry,
  addMetric,
  addOnce,
  deleteEntry,
  deleteNode,
  moveNode,
  moveTargets,
  reorderNodes,
  setNodeArchived,
  toggleCheck,
  updateNode,
  updateOnce,
} from "./actions";
import {
  archivedIds,
  breadcrumb,
  childrenOf,
  isArchived,
  liveChildrenOf,
  formatMetricLabel,
  nodeById,
  recordOf,
  subtreeIds,
  summarizeFlag,
  summarizeMetric,
} from "./domain";
import { activeYears, dayRows, streaks, totals, winOverview, yearHeatmap } from "./stats";
import { monthDays } from "./date";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const TODAY = "2026-08-06";

/** Business > cold calls > "X cold calls za den" */
function baseTree(): { state: MicroWinsState; metricId: string } {
  const a = addCategory(EMPTY_STATE, null, "Business");
  const b = addCategory(a.state, a.node.id, "cold calls");
  const c = addMetric(b.state, b.node.id, { name: "X cold calls za den" });
  return { state: c.state, metricId: c.node.id };
}

describe("zápis záznamu", () => {
  it("první záznam k dnešku je microwin (rekord byl 0)", () => {
    const { state, metricId } = baseTree();
    const r = addEntry(state, { metricId, value: 2 }, TODAY);

    expect(r.evaluation.status).toBe("ok");
    expect(r.evaluation.isMicrowin).toBe(true);
    expect(r.evaluation.isFirstEver).toBe(true);
    expect(r.evaluation.previousRecord).toBe(0);
    expect(r.state.microwins).toHaveLength(1);
  });

  it("nula se ignoruje a nic nezapisuje", () => {
    const { state, metricId } = baseTree();
    const r = addEntry(state, { metricId, value: 0 }, TODAY);

    expect(r.evaluation.status).toBe("ignored-zero");
    expect(r.entry).toBeUndefined();
    expect(r.state.entries).toHaveLength(0);
    expect(r.state.microwins).toHaveLength(0);
  });

  it("záporná hodnota je chyba", () => {
    const { state, metricId } = baseTree();
    const r = addEntry(state, { metricId, value: -3 }, TODAY);

    expect(r.evaluation.status).toBe("invalid");
    expect(r.state.entries).toHaveLength(0);
  });

  it("budoucí datum nejde zapsat", () => {
    const { state, metricId } = baseTree();
    const r = addEntry(state, { metricId, value: 3, date: "2026-08-07" }, TODAY);

    expect(r.evaluation.status).toBe("invalid");
    expect(r.state.entries).toHaveLength(0);
  });

  it("desetinné hodnoty fungují (2.5 H)", () => {
    const { state, metricId } = baseTree();
    const r = addEntry(state, { metricId, value: 2.5 }, TODAY);

    expect(r.entry?.value).toBe(2.5);
    expect(r.evaluation.dayTotal).toBe(2.5);
    expect(r.evaluation.isMicrowin).toBe(true);
  });
});

describe("rekord a microwin", () => {
  it("zadání ze zadání: rekord 2, pak 4 -> PR", () => {
    const { state, metricId } = baseTree();
    const s1 = addEntry(state, { metricId, value: 2, date: "2026-01-01" }, "2026-01-01").state;
    const r = addEntry(s1, { metricId, value: 4 }, TODAY);

    expect(r.evaluation.previousRecord).toBe(2);
    expect(r.evaluation.beatsRecord).toBe(true);
    expect(r.evaluation.isMicrowin).toBe(true);
    expect(r.microwin?.value).toBe(4);
    expect(r.microwin?.previousRecord).toBe(2);
  });

  it("horší výkon než rekord microwin nedává", () => {
    const { state, metricId } = baseTree();
    const s1 = addEntry(state, { metricId, value: 5, date: "2026-01-01" }, "2026-01-01").state;
    const r = addEntry(s1, { metricId, value: 3 }, TODAY);

    expect(r.evaluation.beatsRecord).toBe(false);
    expect(r.evaluation.isMicrowin).toBe(false);
    expect(r.state.microwins.filter((m) => m.date === TODAY)).toHaveLength(0);
  });

  it("shoda s rekordem nestačí, musí být víc", () => {
    const { state, metricId } = baseTree();
    const s1 = addEntry(state, { metricId, value: 4, date: "2026-01-01" }, "2026-01-01").state;
    const r = addEntry(s1, { metricId, value: 4 }, TODAY);

    expect(r.evaluation.isMicrowin).toBe(false);
  });

  it("zpětný zápis microwin nedává, i když překoná rekord", () => {
    const { state, metricId } = baseTree();
    const s1 = addEntry(state, { metricId, value: 2, date: "2026-01-01" }, "2026-01-01").state;
    const r = addEntry(s1, { metricId, value: 10, date: "2026-05-05" }, TODAY);

    expect(r.evaluation.beatsRecord).toBe(true);
    expect(r.evaluation.countsForToday).toBe(false);
    expect(r.evaluation.isMicrowin).toBe(false);
    expect(r.state.microwins.filter((m) => m.date === "2026-05-05")).toHaveLength(0);
    // rekord se ale posunul
    expect(recordOf(r.state.entries).value).toBe(10);
  });

  it("za den a metriku je nejvýš jeden microwin, jen se vylepší", () => {
    const { state, metricId } = baseTree();
    const s1 = addEntry(state, { metricId, value: 3, date: "2026-01-01" }, "2026-01-01").state;
    const r1 = addEntry(s1, { metricId, value: 4 }, TODAY);
    const r2 = addEntry(r1.state, { metricId, value: 2 }, TODAY);

    const todayWins = r2.state.microwins.filter((m) => m.date === TODAY);
    expect(todayWins).toHaveLength(1);
    expect(todayWins[0].value).toBe(6); // 4 + 2 za den
    expect(todayWins[0].previousRecord).toBe(3);
    expect(r2.improved).toBe(true);
  });

  it("dva dílčí zápisy překonají rekord až v součtu", () => {
    const { state, metricId } = baseTree();
    const s1 = addEntry(state, { metricId, value: 5, date: "2026-01-01" }, "2026-01-01").state;
    const r1 = addEntry(s1, { metricId, value: 3 }, TODAY);
    expect(r1.evaluation.isMicrowin).toBe(false);

    const r2 = addEntry(r1.state, { metricId, value: 3 }, TODAY);
    expect(r2.evaluation.dayTotal).toBe(6);
    expect(r2.evaluation.isMicrowin).toBe(true);
  });

  it("agregace max bere nejlepší pokus dne, ne součet", () => {
    const a = addCategory(EMPTY_STATE, null, "Fitness");
    const m = addMetric(a.state, a.node.id, { name: "X kg v bench pressu", aggregation: "max" });
    const s1 = addEntry(m.state, { metricId: m.node.id, value: 80, date: "2026-01-01" }, "2026-01-01").state;
    const r1 = addEntry(s1, { metricId: m.node.id, value: 60 }, TODAY);
    expect(r1.evaluation.dayTotal).toBe(60);
    expect(r1.evaluation.isMicrowin).toBe(false);

    const r2 = addEntry(r1.state, { metricId: m.node.id, value: 85 }, TODAY);
    expect(r2.evaluation.dayTotal).toBe(85);
    expect(r2.evaluation.isMicrowin).toBe(true);
  });

  it("zpětný zápis nad dnešní součet dnešní microwin zruší", () => {
    const { state, metricId } = baseTree();
    const r1 = addEntry(state, { metricId, value: 4 }, TODAY);
    expect(r1.state.microwins).toHaveLength(1);

    const r2 = addEntry(r1.state, { metricId, value: 9, date: "2026-01-01" }, TODAY);
    expect(r2.revoked).toBe(true);
    expect(r2.state.microwins.filter((m) => m.date === TODAY)).toHaveLength(0);
  });

  it("smazání dnešního záznamu microwin odebere", () => {
    const { state, metricId } = baseTree();
    const r = addEntry(state, { metricId, value: 4 }, TODAY);
    const after = deleteEntry(r.state, r.entry!.id, TODAY);

    expect(after.entries).toHaveLength(0);
    expect(after.microwins).toHaveLength(0);
  });

  it("smazání uzlu smaže i záznamy a microwiny podstromu", () => {
    const a = addCategory(EMPTY_STATE, null, "Business");
    const b = addCategory(a.state, a.node.id, "cold calls");
    const c = addMetric(b.state, b.node.id, { name: "X cold calls za den" });
    const withEntry = addEntry(c.state, { metricId: c.node.id, value: 4 }, TODAY).state;

    const after = deleteNode(withEntry, a.node.id);
    expect(after.nodes).toHaveLength(0);
    expect(after.entries).toHaveLength(0);
    expect(after.microwins).toHaveLength(0);
  });
});

describe("zaškrtávací win (check)", () => {
  function withCheck() {
    const a = addCategory(EMPTY_STATE, null, "Fitness");
    const c = addCheck(a.state, a.node.id, "Ranní protažení");
    return { state: c.state, checkId: c.node.id };
  }

  it("zaškrtnutí dneška je microwin bez čísla", () => {
    const { state, checkId } = withCheck();
    const r = toggleCheck(state, checkId, undefined, TODAY);

    expect(r.checked).toBe(true);
    expect(r.state.entries).toHaveLength(1);
    expect(r.state.entries[0].value).toBe(1);
    expect(r.state.microwins).toHaveLength(1);
    expect(r.microwin?.value).toBe(1);
    expect(r.microwin?.previousRecord).toBe(0);
  });

  it("opakované zaškrtnutí dává microwin každý den, ne jen poprvé", () => {
    const { state, checkId } = withCheck();
    const d1 = toggleCheck(state, checkId, "2026-08-04", TODAY);
    const d2 = toggleCheck(d1.state, checkId, "2026-08-05", TODAY);
    const d3 = toggleCheck(d2.state, checkId, TODAY, TODAY);

    expect(d3.state.microwins).toHaveLength(3);
    expect(streaks(d3.state, TODAY).current).toBe(3);
  });

  it("dvojí zaškrtnutí téhož dne microwin nezdvojí", () => {
    const { state, checkId } = withCheck();
    const on = toggleCheck(state, checkId, TODAY, TODAY);
    const off = toggleCheck(on.state, checkId, TODAY, TODAY);
    const again = toggleCheck(off.state, checkId, TODAY, TODAY);

    expect(again.state.entries).toHaveLength(1);
    expect(again.state.microwins).toHaveLength(1);
  });

  it("odškrtnutí microwin toho dne zase odebere", () => {
    const { state, checkId } = withCheck();
    const on = toggleCheck(state, checkId, TODAY, TODAY);
    const off = toggleCheck(on.state, checkId, TODAY, TODAY);

    expect(off.checked).toBe(false);
    expect(off.state.entries).toHaveLength(0);
    expect(off.state.microwins).toHaveLength(0);
  });

  it("zpětné zaškrtnutí win dává ke svému dni (na rozdíl od metriky)", () => {
    const { state, checkId } = withCheck();
    const r = toggleCheck(state, checkId, "2026-08-01", TODAY);

    expect(r.state.microwins).toHaveLength(1);
    expect(r.state.microwins[0].date).toBe("2026-08-01");
    expect(r.state.entries[0].backdated).toBe(true);
  });

  it("budoucí den zaškrtnout nejde", () => {
    const { state, checkId } = withCheck();
    const r = toggleCheck(state, checkId, "2026-08-07", TODAY);

    expect(r.state.entries).toHaveLength(0);
    expect(r.state.microwins).toHaveLength(0);
  });

  it("souhrn počítá dny i sérii", () => {
    const { state, checkId } = withCheck();
    let s = toggleCheck(state, checkId, "2026-08-04", TODAY).state;
    s = toggleCheck(s, checkId, "2026-08-05", TODAY).state;
    s = toggleCheck(s, checkId, TODAY, TODAY).state;

    const node = s.nodes.find((n) => n.id === checkId)!;
    const summary = summarizeFlag(s, node, TODAY);

    expect(summary.dayCount).toBe(3);
    expect(summary.doneToday).toBe(true);
    expect(summary.streak).toBe(3);
    expect(summary.lastDate).toBe(TODAY);
    expect(summary.path).toBe("Fitness");
  });

  it("v přehledu dnů má check text bez čísla", () => {
    const { state, checkId } = withCheck();
    const s = toggleCheck(state, checkId, TODAY, TODAY).state;
    const rows = dayRows(s);

    expect(rows[0].items[0].text).toBe("Ranní protažení");
    expect(rows[0].items[0].kind).toBe("check");
  });
});

describe("jednorázový win (once)", () => {
  it("vytvořením vzniká uzel, záznam i microwin", () => {
    const a = addCategory(EMPTY_STATE, null, "Business");
    const r = addOnce(a.state, a.node.id, { name: "První nabídka", note: "48 000" }, TODAY);

    expect(r.node.kind).toBe("once");
    expect(r.state.entries).toHaveLength(1);
    expect(r.state.entries[0].note).toBe("48 000");
    expect(r.state.microwins).toHaveLength(1);
    expect(r.microwin?.date).toBe(TODAY);
  });

  it("zapsaný ke staršímu dni patří tomu dni", () => {
    const r = addOnce(EMPTY_STATE, null, { name: "Dodělal jsem web", date: "2026-07-30" }, TODAY);

    expect(r.state.microwins[0].date).toBe("2026-07-30");
    expect(totals(r.state, TODAY).today).toBe(0);
  });

  it("budoucí datum spadne na dnešek", () => {
    const r = addOnce(EMPTY_STATE, null, { name: "Zítřek", date: "2026-09-01" }, TODAY);

    expect(r.state.entries[0].date).toBe(TODAY);
    expect(r.state.microwins[0].date).toBe(TODAY);
  });

  it("přesun data přesune i microwin", () => {
    const r = addOnce(EMPTY_STATE, null, { name: "Web hotov" }, TODAY);
    const moved = updateOnce(r.state, r.node.id, { date: "2026-08-01" }, TODAY);

    expect(moved.microwins).toHaveLength(1);
    expect(moved.microwins[0].date).toBe("2026-08-01");
    expect(moved.entries[0].date).toBe("2026-08-01");
  });

  it("smazání záznamu microwin odebere", () => {
    const r = addOnce(EMPTY_STATE, null, { name: "Web hotov" }, TODAY);
    const after = deleteEntry(r.state, r.state.entries[0].id, TODAY);

    expect(after.microwins).toHaveLength(0);
  });
});

describe("pořadí ve složce", () => {
  const folder = () => {
    const cat = addCategory(EMPTY_STATE, null, "Business");
    const parent = cat.node.id;
    let s = addOnce(cat.state, parent, { name: "jednorázový" }, TODAY).state;
    s = addCheck(s, parent, "zaškrtávací").state;
    s = addMetric(s, parent, { name: "X čísel" }).state;
    s = addCategory(s, parent, "podsložka").state;
    return { state: s, parent };
  };

  it("nové položky přibývají na konec, druh do toho nemluví", () => {
    const { state, parent } = folder();

    expect(childrenOf(state.nodes, parent).map((n) => n.kind)).toEqual([
      "once",
      "check",
      "metric",
      "category",
    ]);
  });

  it("přetažení pořadí opravdu změní - a vydrží", () => {
    const { state, parent } = folder();
    const ids = childrenOf(state.nodes, parent).map((n) => n.id);
    // složku (poslední) nahoru
    const moved = [ids[3], ids[0], ids[1], ids[2]];

    const next = reorderNodes(state, moved);

    expect(childrenOf(next.nodes, parent).map((n) => n.id)).toEqual(moved);
  });

  it("přeuspořádání jedné složky nesahá na sousední", () => {
    const a = addCategory(EMPTY_STATE, null, "A");
    const b = addCategory(a.state, null, "B");
    let s = addMetric(b.state, a.node.id, { name: "a1" }).state;
    s = addMetric(s, b.node.id, { name: "b1" }).state;
    s = addMetric(s, a.node.id, { name: "a2" }).state;
    s = addMetric(s, b.node.id, { name: "b2" }).state;

    const inB = childrenOf(s.nodes, b.node.id).map((n) => n.id);
    const next = reorderNodes(s, [inB[1], inB[0]]);

    expect(childrenOf(next.nodes, b.node.id).map((n) => n.id)).toEqual([inB[1], inB[0]]);
    expect(childrenOf(next.nodes, a.node.id).map((n) => n.name)).toEqual(["a1", "a2"]);
  });
});

describe("ikona složky", () => {
  it("založí se s vybranou ikonou", () => {
    const cat = addCategory(EMPTY_STATE, null, "Fitness", "lucide:Dumbbell");

    expect(cat.node.icon).toBe("lucide:Dumbbell");
  });

  it("bez ikony zůstane nevyplněná, ne prázdný string", () => {
    // Starší data ikonu neznají a nesmí se migrovat - `undefined` je signál
    // "kresli složku", zatímco "" by se do zálohy uložilo jako ikona.
    expect(addCategory(EMPTY_STATE, null, "Business").node.icon).toBeUndefined();
    expect(addCategory(EMPTY_STATE, null, "Business", "  ").node.icon).toBeUndefined();
  });

  it("dá se přepsat i vrátit na výchozí složku", () => {
    const cat = addCategory(EMPTY_STATE, null, "Business", "💼");

    const changed = updateNode(cat.state, cat.node.id, { icon: "lucide:Rocket" }, TODAY);
    expect(nodeById(changed.nodes, cat.node.id)?.icon).toBe("lucide:Rocket");

    const cleared = updateNode(changed, cat.node.id, { icon: "" }, TODAY);
    expect(nodeById(cleared.nodes, cat.node.id)?.icon).toBeUndefined();
  });

  it("přejmenování ikonu nesundá", () => {
    const cat = addCategory(EMPTY_STATE, null, "Business", "💼");
    const renamed = updateNode(cat.state, cat.node.id, { name: "Podnikání" }, TODAY);

    expect(nodeById(renamed.nodes, cat.node.id)?.name).toBe("Podnikání");
    expect(nodeById(renamed.nodes, cat.node.id)?.icon).toBe("💼");
  });
});

describe("popisky", () => {
  it("nahradí X hodnotou daného dne", () => {
    expect(formatMetricLabel("X cold calls za den", 4)).toBe("4 cold calls za den");
    expect(formatMetricLabel("x cold calls za den", 4)).toBe("4 cold calls za den");
  });

  it("respektuje jednotku a české desetinné čárky", () => {
    expect(formatMetricLabel("X tréninku", 2.5, "H")).toBe("2,5 H tréninku");
  });

  it("bez zástupného X předsadí hodnotu dopředu", () => {
    expect(formatMetricLabel("kliků", 30)).toBe("30 kliků");
  });

  it("nesahá na X uvnitř slova", () => {
    expect(formatMetricLabel("MAX X km", 3)).toBe("MAX 3 km");
  });
});

describe("statistiky", () => {
  function withHistory() {
    const { state, metricId } = baseTree();
    let s = state;
    // microwiny ve dnech -2, -1, dnes
    s = addEntry(s, { metricId, value: 1, date: "2026-08-04" }, "2026-08-04").state;
    s = addEntry(s, { metricId, value: 2, date: "2026-08-05" }, "2026-08-05").state;
    s = addEntry(s, { metricId, value: 3, date: TODAY }, TODAY).state;
    return s;
  }

  it("série se počítá přes po sobě jdoucí dny", () => {
    const s = withHistory();
    const info = streaks(s, TODAY);

    expect(info.current).toBe(3);
    expect(info.longest).toBe(3);
    expect(info.todayDone).toBe(true);
    expect(info.atRisk).toBe(false);
  });

  it("bez dnešního microwinu série žije z včerejška a je v ohrožení", () => {
    const { state, metricId } = baseTree();
    let s = addEntry(state, { metricId, value: 1, date: "2026-08-04" }, "2026-08-04").state;
    s = addEntry(s, { metricId, value: 2, date: "2026-08-05" }, "2026-08-05").state;

    const info = streaks(s, TODAY);
    expect(info.current).toBe(2);
    expect(info.todayDone).toBe(false);
    expect(info.atRisk).toBe(true);
  });

  it("mezera sérii přeruší", () => {
    const { state, metricId } = baseTree();
    let s = addEntry(state, { metricId, value: 1, date: "2026-08-01" }, "2026-08-01").state;
    s = addEntry(s, { metricId, value: 5, date: TODAY }, TODAY).state;

    const info = streaks(s, TODAY);
    expect(info.current).toBe(1);
    expect(info.longest).toBe(1);
  });

  it("tabulka dnů vrací text s dosazenou hodnotou", () => {
    const s = withHistory();
    const rows = dayRows(s);

    expect(rows[0].date).toBe(TODAY);
    expect(rows[0].count).toBe(1);
    expect(rows[0].items[0].text).toBe("3 cold calls za den");
  });

  it("souhrny počítají dnešek, týden i nejlepší den", () => {
    const s = withHistory();
    const t = totals(s, TODAY);

    expect(t.allTime).toBe(3);
    expect(t.today).toBe(1);
    expect(t.last7).toBe(3);
    expect(t.activeDays).toBe(3);
    expect(t.bestDay?.count).toBe(1);
  });

  it("souhrn metriky ukáže rekord i kolik chybí", () => {
    const { state, metricId } = baseTree();
    let s = addEntry(state, { metricId, value: 10, date: "2026-01-01" }, "2026-01-01").state;
    s = addEntry(s, { metricId, value: 4, date: TODAY }, TODAY).state;

    const metric = s.nodes.find((n) => n.id === metricId)!;
    const summary = summarizeMetric(s, metric, TODAY);

    expect(summary.record.value).toBe(10);
    expect(summary.todayTotal).toBe(4);
    expect(summary.toRecord).toBe(6);
    expect(summary.path).toBe("Business / cold calls");
    expect(summary.hasMicrowinToday).toBe(false);
  });
});

describe("přesun složky", () => {
  /** Business > cold calls > metrika, vedle toho Fitness */
  function twoRoots() {
    const a = addCategory(EMPTY_STATE, null, "Business");
    const b = addCategory(a.state, a.node.id, "cold calls");
    const c = addMetric(b.state, b.node.id, { name: "X cold calls za den" });
    const d = addCategory(c.state, null, "Fitness");
    return {
      state: d.state,
      business: a.node.id,
      coldCalls: b.node.id,
      metric: c.node.id,
      fitness: d.node.id,
    };
  }

  it("přesune složku i s obsahem pod jinou složku", () => {
    const t = twoRoots();
    const s = moveNode(t.state, t.coldCalls, t.fitness);

    expect(childrenOf(s.nodes, t.fitness).map((n) => n.id)).toEqual([t.coldCalls]);
    expect(childrenOf(s.nodes, t.business)).toEqual([]);
    // podstrom jede s ní, jen se překreslí cesta
    expect(subtreeIds(s.nodes, t.coldCalls)).toContain(t.metric);
    expect(breadcrumb(s.nodes, t.metric)).toBe("Fitness / cold calls");
  });

  it("umí složku vytáhnout na kořen", () => {
    const t = twoRoots();
    const s = moveNode(t.state, t.coldCalls, null);

    expect(childrenOf(s.nodes, null).map((n) => n.name)).toContain("cold calls");
    expect(breadcrumb(s.nodes, t.metric)).toBe("cold calls");
  });

  it("do vlastního potomka ani do sebe to nepustí", () => {
    const t = twoRoots();

    expect(moveNode(t.state, t.business, t.coldCalls)).toBe(t.state);
    expect(moveNode(t.state, t.business, t.business)).toBe(t.state);
  });

  it("cílem nemůže být win, jen složka", () => {
    const t = twoRoots();
    expect(moveNode(t.state, t.fitness, t.metric)).toBe(t.state);
  });

  it("nabídka cílů vynechá uzel i jeho potomky", () => {
    const t = twoRoots();
    const targets = moveTargets(t.state, t.business).map((n) => n.id);

    expect(targets).toEqual([t.fitness]);
  });

  it("přesun nemění záznamy ani microwiny", () => {
    const t = twoRoots();
    const withEntry = addEntry(t.state, { metricId: t.metric, value: 3 }, TODAY).state;
    const s = moveNode(withEntry, t.coldCalls, t.fitness);

    expect(s.entries).toEqual(withEntry.entries);
    expect(s.microwins).toEqual(withEntry.microwins);
  });
});

describe("kalendář roku", () => {
  it("pokrývá celý rok a krajní dny označí jako cizí", () => {
    const grid = yearHeatmap(EMPTY_STATE, 2026, TODAY);
    const cells = grid.flat();

    expect(grid.every((column) => column.length === 7)).toBe(true);
    expect(cells.filter((c) => !c.outside)[0].date).toBe("2026-01-01");
    expect(cells.filter((c) => !c.outside).at(-1)!.date).toBe("2026-12-31");
    expect(cells.filter((c) => !c.outside)).toHaveLength(365);
    // 1. 1. 2026 je čtvrtek, týden začíná pondělkem 29. 12. 2025
    expect(cells[0].date).toBe("2025-12-29");
    expect(cells[0].outside).toBe(true);
  });

  it("dny po dnešku jsou budoucí", () => {
    const grid = yearHeatmap(EMPTY_STATE, 2026, TODAY);
    const cells = grid.flat().filter((c) => !c.outside);

    expect(cells.find((c) => c.date === TODAY)!.future).toBe(false);
    expect(cells.find((c) => c.date === "2026-12-31")!.future).toBe(true);
  });

  it("počítá microwiny do správných dnů", () => {
    const { state, metricId } = baseTree();
    const s = addEntry(state, { metricId, value: 3 }, TODAY).state;
    const cells = yearHeatmap(s, 2026, TODAY).flat();

    expect(cells.find((c) => c.date === TODAY)!.count).toBe(1);
  });

  it("nabídne roky s microwiny a k tomu letošek", () => {
    const { state, metricId } = baseTree();
    // microwin vzniká vždy k "dnešku", takže minulý rok se dá udělat jen
    // zápisem v době, kdy ten den dneškem byl
    const past = addEntry(state, { metricId, value: 5, date: "2024-03-03" }, "2024-03-03").state;
    expect(past.microwins).toHaveLength(1);

    expect(activeYears(past, TODAY)).toEqual([2024, 2026]);
    // letošek je v nabídce i bez jediného microwinu
    expect(activeYears(EMPTY_STATE, TODAY)).toEqual([2026]);
  });
});

describe("přehled winů", () => {
  it("popíše všechny tři druhy a jejich dnešek", () => {
    const cat = addCategory(EMPTY_STATE, null, "Business");
    const metric = addMetric(cat.state, cat.node.id, { name: "X cold calls za den", unit: "ks" });
    const check = addCheck(metric.state, cat.node.id, "Ranní protažení");
    const once = addOnce(check.state, cat.node.id, { name: "První nabídka" }, TODAY);

    let s = addEntry(once.state, { metricId: metric.node.id, value: 10, date: "2026-01-01" }, TODAY)
      .state;
    s = addEntry(s, { metricId: metric.node.id, value: 4 }, TODAY).state;
    s = toggleCheck(s, check.node.id, TODAY, TODAY).state;

    const rows = winOverview(s, TODAY);
    expect(rows).toHaveLength(3);

    const m = rows.find((r) => r.kind === "metric")!;
    expect(m.kind === "metric" && m.record).toBe(10);
    expect(m.kind === "metric" && m.todayTotal).toBe(4);
    expect(m.kind === "metric" && m.toRecord).toBe(6);
    expect(m.kind === "metric" && Math.round(m.progress)).toBe(40);
    expect(m.activeToday).toBe(true);
    expect(m.winToday).toBe(false); // 4 na rekord 10 nestačí
    expect(m.path).toBe("Business");

    const c = rows.find((r) => r.kind === "check")!;
    expect(c.kind === "check" && c.doneToday).toBe(true);
    expect(c.kind === "check" && c.recentDays.at(-1)).toBe(true);
    expect(c.kind === "check" && c.recentDays).toHaveLength(7);
    expect(c.winToday).toBe(true);

    const o = rows.find((r) => r.kind === "once")!;
    expect(o.kind === "once" && o.date).toBe(TODAY);
    expect(o.winToday).toBe(true);
  });

  it("win bez zápisu má nulový rekord a nic dnes", () => {
    const cat = addCategory(EMPTY_STATE, null, "Fitness");
    const metric = addMetric(cat.state, cat.node.id, { name: "X kliků" });
    const row = winOverview(metric.state, TODAY)[0];

    expect(row.kind === "metric" && row.record).toBe(0);
    expect(row.kind === "metric" && row.progress).toBe(0);
    expect(row.activeToday).toBe(false);
    expect(row.microwinCount).toBe(0);
  });

  it("složky do přehledu nepatří, jen winy", () => {
    const cat = addCategory(EMPTY_STATE, null, "Business");
    const sub = addCategory(cat.state, cat.node.id, "cold calls");

    expect(winOverview(sub.state, TODAY)).toEqual([]);
  });
});

describe("pruh měsíce", () => {
  it("vrátí všechny dny měsíce", () => {
    expect(monthDays("2026-08-10")).toHaveLength(31);
    expect(monthDays("2026-02-14")).toHaveLength(28);
    expect(monthDays("2024-02-14")).toHaveLength(29); // přestupný rok
  });

  it("začíná prvním a končí posledním dnem", () => {
    const days = monthDays(TODAY);
    expect(days[0]).toBe("2026-08-01");
    expect(days.at(-1)).toBe("2026-08-31");
    expect(days).toContain(TODAY);
  });
});

describe("archivace ve stromu", () => {
  /** Business > cold calls > metrika, vedle toho Fitness. */
  function tree() {
    const a = addCategory(EMPTY_STATE, null, "Business");
    const b = addCategory(a.state, a.node.id, "cold calls");
    const c = addMetric(b.state, b.node.id, { name: "X cold calls za den" });
    const d = addCategory(c.state, null, "Fitness");
    return {
      state: d.state,
      business: a.node.id,
      coldCalls: b.node.id,
      metric: c.node.id,
      fitness: d.node.id,
    };
  }

  it("archivovaný uzel zmizí z obsahu složky, ale ve stavu zůstane", () => {
    const t = tree();
    const s = setNodeArchived(t.state, t.coldCalls, true);

    expect(liveChildrenOf(s.nodes, t.business)).toEqual([]);
    expect(childrenOf(s.nodes, t.business).map((n) => n.id)).toEqual([t.coldCalls]);
    expect(nodeById(s.nodes, t.coldCalls)?.archivedAt).toBeTruthy();
  });

  it("archivace bere podstrom s sebou (dědí se po rodičích)", () => {
    const t = tree();
    const s = setNodeArchived(t.state, t.business, true);

    expect(isArchived(s.nodes, t.metric)).toBe(true);
    expect(archivedIds(s.nodes)).toEqual(new Set([t.business, t.coldCalls, t.metric]));
    // Fitness je vedle, archivace do něj nemluví
    expect(isArchived(s.nodes, t.fitness)).toBe(false);
  });

  it("záznamy ani microwiny se archivací neztrácejí", () => {
    const t = tree();
    const withEntry = addEntry(t.state, { metricId: t.metric, value: 4 }, TODAY);
    expect(withEntry.state.microwins).toHaveLength(1);

    const s = setNodeArchived(withEntry.state, t.coldCalls, true);
    expect(s.entries).toHaveLength(1);
    expect(s.microwins).toHaveLength(1);
    expect(totals(s, TODAY).allTime).toBe(1);
    expect(totals(s, TODAY).today).toBe(1);
    expect(winOverview(s, TODAY).find((w) => w.node.id === t.metric)?.microwinCount).toBe(1);
  });

  it("odarchivace vrátí uzel zpátky na jeho místo", () => {
    const t = tree();
    const archived = setNodeArchived(t.state, t.coldCalls, true);
    const s = setNodeArchived(archived, t.coldCalls, false);

    expect(nodeById(s.nodes, t.coldCalls)?.archivedAt).toBeNull();
    expect(liveChildrenOf(s.nodes, t.business).map((n) => n.id)).toEqual([t.coldCalls]);
  });

  it("vrácení složky nevrátí to, co v ní bylo archivované zvlášť", () => {
    const t = tree();
    let s = setNodeArchived(t.state, t.metric, true);
    s = setNodeArchived(s, t.coldCalls, true);
    s = setNodeArchived(s, t.coldCalls, false);

    expect(liveChildrenOf(s.nodes, t.coldCalls)).toEqual([]);
    expect(isArchived(s.nodes, t.metric)).toBe(true);
  });

  it("stejný stav archivu nic nepřepisuje", () => {
    const t = tree();
    expect(setNodeArchived(t.state, t.coldCalls, false)).toBe(t.state);
    expect(setNodeArchived(t.state, "neexistuje", true)).toBe(t.state);
  });

  it("do archivované složky se nedá přesouvat", () => {
    const t = tree();
    const s = setNodeArchived(t.state, t.fitness, true);

    expect(moveTargets(s, t.coldCalls).map((n) => n.id)).not.toContain(t.fitness);
    expect(moveNode(s, t.coldCalls, t.fitness)).toBe(s);
  });
});
