import { describe, expect, it } from "vitest";
import { addCategory, addCheck, addEntry, addMetric, toggleCheck } from "./actions";
import {
  candidates,
  canDraw,
  countsForPush,
  drawPushWin,
  evaluatePushWin,
  ladder,
  median,
  pushableNodes,
  pushWinStatus,
  rollDifficulty,
  settlePushWins,
  DEFAULT_ODDS,
  PUSHWIN_UNLOCK,
} from "./pushwin";
import { EMPTY_STATE, type MicroWinsState, type PushWin } from "./types";

const TODAY = "2026-08-12"; // středa
const WEEK = "2026-08-10"; // pondělí téhož týdne

/** Strom se dvěma složkami, metrikou a checkem plus dost historie. */
function seeded(): { state: MicroWinsState; metricId: string; checkId: string; folderId: string } {
  const business = addCategory(EMPTY_STATE, null, "Business");
  const zdravi = addCategory(business.state, null, "Zdraví");
  const metric = addMetric(zdravi.state, zdravi.node.id, { name: "X kliků", unit: "ks" });
  const check = addCheck(metric.state, business.node.id, "Ranní protažení");

  let state = check.state;
  // Denní součty 30-40 na metrice, každý den jiný - přesně ten případ,
  // kdy má laťka vyjít mezi typickou hodnotou a rekordem.
  const values = [30, 34, 31, 38, 33, 40, 32, 35, 36, 34];
  values.forEach((value, i) => {
    const date = `2026-07-${String(i + 1).padStart(2, "0")}`;
    state = addEntry(state, { metricId: metric.node.id, value, date }, date).state;
  });

  return {
    state,
    metricId: metric.node.id,
    checkId: check.node.id,
    folderId: business.node.id,
  };
}

describe("laťka", () => {
  it("lehká míří pod rekord, střední přes něj, těžká výš", () => {
    expect(ladder(34, 40, "easy")).toBe(38);
    expect(ladder(34, 40, "medium")).toBe(41);
    expect(ladder(34, 40, "hard")).toBe(44);
  });

  it("lehká je vždycky aspoň o krok nad běžnou hodnotou", () => {
    // Bez rekordu navíc by lehká vyšla na stejné číslo, jaké člověk dává běžně.
    expect(ladder(5, 5, "easy")).toBe(6);
  });

  it("medián se nedá rozhodit jedním výstřelem", () => {
    expect(median([3, 3, 3, 3, 100])).toBe(3);
    expect(median([])).toBe(0);
  });
});

describe("losování", () => {
  it("do 50 microwinů se nelosuje", () => {
    const { state } = seeded();
    expect(state.microwins.length).toBeLessThan(PUSHWIN_UNLOCK);
    expect(canDraw(state, TODAY).reason).toBe("locked");
    expect(drawPushWin(state, DEFAULT_ODDS, TODAY).pushWin).toBeNull();
  });

  it("obtížnost sedí na nastavené šance", () => {
    expect(rollDifficulty({ easy: 50, medium: 30, hard: 20 }, 0.1)).toBe("easy");
    expect(rollDifficulty({ easy: 50, medium: 30, hard: 20 }, 0.6)).toBe("medium");
    expect(rollDifficulty({ easy: 50, medium: 30, hard: 20 }, 0.9)).toBe("hard");
    // Samé nuly nesmí spadnout mimo rozsah.
    expect(rollDifficulty({ easy: 0, medium: 0, hard: 0 }, 0.5)).toBe("easy");
  });

  it("běžící výzvu nejde přelosovat", () => {
    const state = unlocked();
    const first = drawPushWin(state, DEFAULT_ODDS, TODAY, [0.1, 0.1]);
    expect(first.pushWin).not.toBeNull();
    expect(canDraw(first.state, TODAY).reason).toBe("running");
    expect(drawPushWin(first.state, DEFAULT_ODDS, TODAY).pushWin).toBeNull();
  });

  it("cíl vychází z dat uživatele, ne z pevného čísla", () => {
    const pool = candidates(unlocked(), "easy", TODAY);
    const record = pool.find((c) => c.kind === "record");
    expect(record).toBeDefined();
    // Historie je 30-40, takže lehká výzva musí spadnout dovnitř toho pásma.
    expect(record!.target).toBeGreaterThan(34);
    expect(record!.target).toBeLessThanOrEqual(40);
  });

  it("odložená složka se do výzev nedostane", () => {
    const base = unlocked();
    const zdravi = base.nodes.find((n) => n.name === "Zdraví")!;
    const state: MicroWinsState = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === zdravi.id ? { ...n, pushExempt: true } : n)),
    };

    const ids = new Set(pushableNodes(state).map((n) => n.id));
    expect(ids.has(zdravi.id)).toBe(false);
    // Metrika leží pod odloženou složkou, takže padá taky.
    const metric = state.nodes.find((n) => n.kind === "metric")!;
    expect(ids.has(metric.id)).toBe(false);
    expect(candidates(state, "easy", TODAY).some((c) => c.nodeId === metric.id)).toBe(false);
  });
});

describe("vyhodnocení", () => {
  it("zpětný zápis se do výzvy nepočítá", () => {
    const { state, checkId } = seeded();
    // Zaškrtnuto dnes, ale k včerejšku - pro výzvu neplatí.
    const back = toggleCheck(state, checkId, "2026-08-11", TODAY).state;
    const microwin = back.microwins.find((m) => m.date === "2026-08-11");
    expect(microwin).toBeDefined();
    expect(countsForPush(back, microwin!)).toBe(false);
  });

  it("nádech se splní, až padne dost microwinů v jednom dni", () => {
    const { state, checkId } = seeded();
    const push = makePush({ kind: "burst", target: 2 });
    const withPush: MicroWinsState = { ...state, pushWins: [push] };

    expect(evaluatePushWin(withPush, push).done).toBe(false);

    const first = toggleCheck(withPush, checkId, TODAY, TODAY).state;
    const metric = state.nodes.find((n) => n.kind === "metric")!;
    const second = addEntry(first, { metricId: metric.id, value: 99 }, TODAY).state;

    const progress = evaluatePushWin(second, push);
    expect(progress.current).toBe(2);
    expect(progress.done).toBe(true);
    expect(progress.microwinIds).toHaveLength(2);
  });

  it("rekordní výzva se počítá ze záznamů dne", () => {
    const { state, metricId } = seeded();
    const push = makePush({ kind: "record", target: 44, nodeId: metricId });
    const withPush: MicroWinsState = { ...state, pushWins: [push] };

    const low = addEntry(withPush, { metricId, value: 20 }, TODAY).state;
    expect(evaluatePushWin(low, push).done).toBe(false);

    const high = addEntry(low, { metricId, value: 24 }, TODAY).state;
    expect(evaluatePushWin(high, push).current).toBe(44);
    expect(evaluatePushWin(high, push).done).toBe(true);
  });

  it("splněnou výzvu settle uzavře i se seznamem microwinů", () => {
    const { state, checkId } = seeded();
    const push = makePush({ kind: "burst", target: 1 });
    const withPush: MicroWinsState = { ...state, pushWins: [push] };
    const after = settlePushWins(toggleCheck(withPush, checkId, TODAY, TODAY).state, TODAY);

    expect(after.pushWins[0].completedAt).not.toBeNull();
    expect(after.pushWins[0].microwinIds).toHaveLength(1);
    expect(pushWinStatus(after.pushWins[0], TODAY)).toBe("done");
  });

  it("nesplněná výzva z minulého týdne propadne", () => {
    const push = makePush({ kind: "burst", target: 3, week: "2026-08-03" });
    expect(pushWinStatus(push, TODAY)).toBe("failed");
  });

  it("výzva na smazaný uzel se tiše zruší, ne propadne", () => {
    const { state, metricId } = seeded();
    const push = makePush({ kind: "record", target: 50, nodeId: metricId });
    const orphaned: MicroWinsState = {
      ...state,
      nodes: state.nodes.filter((n) => n.id !== metricId),
      pushWins: [push],
    };

    expect(settlePushWins(orphaned, TODAY).pushWins).toHaveLength(0);
  });
});

/** Stav s dost microwiny na odemčení - PushWiny se do 50 nenabízejí. */
function unlocked(): MicroWinsState {
  const { state } = seeded();
  const filler = Array.from({ length: PUSHWIN_UNLOCK }, (_, i) => ({
    id: `mw_fill_${i}`,
    metricId: state.nodes.find((n) => n.kind === "metric")!.id,
    date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
    value: 1,
    previousRecord: 0,
    firstEver: false,
    createdAt: "2026-06-01T00:00:00.000Z",
  }));
  return { ...state, microwins: [...state.microwins, ...filler] };
}

function makePush(patch: Partial<PushWin>): PushWin {
  return {
    id: "psh_test",
    week: WEEK,
    kind: "burst",
    difficulty: "easy",
    target: 2,
    nodeId: null,
    text: "test",
    drawnAt: `${WEEK}T00:00:00.000Z`,
    completedAt: null,
    microwinIds: [],
    ...patch,
  };
}
