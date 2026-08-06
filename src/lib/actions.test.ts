import { describe, expect, it } from "vitest";
import { addCategory, addEntry, addMetric, deleteEntry, deleteNode } from "./actions";
import { formatMetricLabel, recordOf, summarizeMetric } from "./domain";
import { streaks, dayRows, totals } from "./stats";
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
