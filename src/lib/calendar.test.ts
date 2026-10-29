import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@ebarooni/capacitor-calendar";
import {
  applyPulls,
  dayEvents,
  dayStartMs,
  eventTitle,
  markerOf,
  mirrorDescription,
  mirrorFrom,
  mirrorItems,
  parseEventTitle,
  planMirror,
  type MirrorApi,
  type MirrorBase,
  type MirrorEvent,
  type MirrorItem,
} from "./calendar";
import { addBlock } from "./timeblocks";
import { addTodo, setTodoDue, toggleTodo } from "./todos";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const MIN = 60_000;
const DAY = "2026-10-29";
const NOON = new Date("2026-10-29T12:00:00.000Z");

function event(patch: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "1",
    title: "Porada",
    startDate: 0,
    endDate: 0,
    isAllDay: false,
    description: null,
    calendarId: "c1",
    ...patch,
  } as CalendarEvent;
}

describe("dayEvents", () => {
  const at = (minutes: number, date = DAY) => dayStartMs(date) + minutes * MIN;

  it("přepočte událost na minuty od půlnoci", () => {
    const [e] = dayEvents([event({ startDate: at(9 * 60 + 15), endDate: at(10 * 60) })], DAY);
    expect(e).toMatchObject({ start: 555, duration: 45, allDay: false });
  });

  it("událost přes půlnoc ořízne na den", () => {
    const night = event({ startDate: at(23 * 60, "2026-10-28"), endDate: at(60) });
    expect(dayEvents([night], DAY)[0]).toMatchObject({ start: 0, duration: 60 });
    expect(dayEvents([night], "2026-10-28")[0]).toMatchObject({ start: 23 * 60, duration: 60 });
  });

  it("vynechá události jiných dnů", () => {
    expect(dayEvents([event({ startDate: at(-60), endDate: at(0) })], DAY)).toEqual([]);
  });

  it("celodenní událost čte v UTC a konec bere výlučně", () => {
    const allDay = event({ isAllDay: true, startDate: Date.UTC(2026, 9, 29), endDate: Date.UTC(2026, 9, 31) });
    expect(dayEvents([allDay], "2026-10-29")[0]?.allDay).toBe(true);
    expect(dayEvents([allDay], "2026-10-30")).toHaveLength(1);
    expect(dayEvents([allDay], "2026-10-31")).toEqual([]);
  });
});

describe("značka a název", () => {
  it("najde id a cizí popis ignoruje", () => {
    expect(markerOf(mirrorDescription("blk_x1_ab-c"))).toBe("blk_x1_ab-c");
    expect(markerOf("Schůzka s microwins týmem")).toBeNull();
    expect(markerOf(null)).toBeNull();
  });

  it("značku najde i v popisu, který Google vrátil jako HTML", () => {
    expect(markerOf("Z MicroWins<br>microwins:blk_x1_ab</p>")).toBe("blk_x1_ab");
  });

  it("odškrtnutí je ✓ na začátku, z Googlu stačí i ✔ nebo ✅", () => {
    expect(eventTitle({ title: "Psaní", done: true })).toBe("✓ Psaní");
    expect(parseEventTitle("✓ Psaní")).toEqual({ title: "Psaní", done: true });
    expect(parseEventTitle("✔Psaní")).toEqual({ title: "Psaní", done: true });
    expect(parseEventTitle("✅ Psaní")).toEqual({ title: "Psaní", done: true });
    expect(parseEventTitle("Psaní ✓")).toEqual({ title: "Psaní ✓", done: false });
  });

  it("zrcadlí se od včerejška", () => {
    expect(mirrorFrom(DAY)).toBe("2026-10-28");
  });
});

describe("mirrorItems", () => {
  const block = (state: MicroWinsState, date: string, title: string) =>
    addBlock(state, { date, start: 9 * 60, duration: 60, title }, NOON);

  it("bere bloky od včerejška bez horní hranice, starší ne", () => {
    let state = block(EMPTY_STATE, "2026-10-27", "předevčírem").state;
    state = block(state, "2026-10-28", "včera").state;
    state = block(state, "2026-12-24", "Vánoce").state;
    const items = mirrorItems(state, "2026-10-28");
    expect(items.map((i) => i.title).sort()).toEqual(["Vánoce", "včera"]);
    expect(items[0]).toMatchObject({ kind: "block", done: false });
    expect(items[0].endDate - items[0].startDate).toBe(60 * MIN);
  });

  it("ToDo s termínem a hodinou je půlhodina v čase termínu, i daleko dopředu", () => {
    const added = addTodo(EMPTY_STATE, "autoškola", NOON);
    const state = setTodoDue(added.state, added.todo!.id, "2026-12-01", "08:00");
    const [item] = mirrorItems(state, "2026-10-28");
    expect(item).toMatchObject({ key: added.todo!.id, kind: "todo", title: "autoškola", done: false });
    expect(item.startDate).toBe(dayStartMs("2026-12-01") + 8 * 60 * MIN);
    expect(item.endDate - item.startDate).toBe(30 * MIN);
  });

  it("ToDo bez hodiny, odškrtnuté, prošlé ani naplánované do mřížky v kalendáři není", () => {
    const a = addTodo(EMPTY_STATE, "bez hodiny", NOON);
    let state = setTodoDue(a.state, a.todo!.id, DAY, null);
    const b = addTodo(state, "hotové", NOON);
    state = toggleTodo(setTodoDue(b.state, b.todo!.id, DAY, "10:00"), b.todo!.id, NOON);
    const c = addTodo(state, "prošlé", NOON);
    state = setTodoDue(c.state, c.todo!.id, "2026-10-20", "10:00");
    const d = addTodo(state, "v mřížce", NOON);
    state = setTodoDue(d.state, d.todo!.id, DAY, "14:00");
    state = addBlock(state, { date: DAY, start: 14 * 60, duration: 30, title: "v mřížce", todoId: d.todo!.id }, NOON).state;

    const items = mirrorItems(state, "2026-10-28");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "block", title: "v mřížce" });
  });
});

describe("planMirror", () => {
  const H = { from: 0, pastKeys: new Set<string>() };
  const item = (patch: Partial<MirrorItem> = {}): MirrorItem => ({
    key: "b1",
    kind: "block",
    title: "Psaní",
    done: false,
    startDate: 100 * MIN,
    endDate: 200 * MIN,
    ...patch,
  });
  const ev = (id: string, patch: Partial<MirrorEvent> = {}): MirrorEvent => ({
    id,
    key: "b1",
    title: "Psaní",
    startDate: 100 * MIN,
    endDate: 200 * MIN,
    allDay: false,
    recurring: false,
    ...patch,
  });
  const base = (id: string, patch: Partial<MirrorBase> = {}): Record<string, MirrorBase> => ({
    b1: { eventId: id, title: "Psaní", startDate: 100 * MIN, endDate: 200 * MIN, ...patch },
  });

  it("chybějící událost založí", () => {
    const plan = planMirror([item()], [], {}, H);
    expect(plan).toMatchObject({ create: [item()], update: [], remove: [], pull: [] });
  });

  it("beze změny nedělá nic a základ drží", () => {
    const plan = planMirror([item()], [ev("1")], base("1"), H);
    expect(plan).toMatchObject({ create: [], update: [], remove: [], pull: [] });
    expect(plan.base.b1).toEqual(base("1").b1);
  });

  it("změna v appce přepíše kalendář", () => {
    const plan = planMirror([item({ startDate: 150 * MIN, endDate: 250 * MIN })], [ev("1")], base("1"), H);
    expect(plan.update).toEqual([{ ...item({ startDate: 150 * MIN, endDate: 250 * MIN }), id: "1" }]);
    expect(plan.pull).toEqual([]);
    expect(plan.base.b1.startDate).toBe(150 * MIN);
  });

  it("změnu v kalendáři převezme appka: název, čas i odškrtnutí", () => {
    const remote = ev("1", { title: "✓ Psaní knihy", startDate: 300 * MIN, endDate: 360 * MIN });
    const plan = planMirror([item()], [remote], base("1"), H);
    expect(plan.update).toEqual([]);
    expect(plan.pull).toEqual([
      { key: "b1", kind: "block", title: "Psaní knihy", done: true, startDate: 300 * MIN, endDate: 360 * MIN },
    ]);
    expect(plan.base.b1).toMatchObject({ title: "✓ Psaní knihy", startDate: 300 * MIN });
  });

  it("odškrtnutí zrušené v kalendáři se převezme taky", () => {
    const plan = planMirror([item({ done: true })], [ev("1")], base("1", { title: "✓ Psaní" }), H);
    expect(plan.pull).toEqual([{ key: "b1", kind: "block", done: false }]);
  });

  it("změna na obou stranách: vyhrává appka", () => {
    const plan = planMirror(
      [item({ title: "Appka" })],
      [ev("1", { title: "Google" })],
      base("1"),
      H,
    );
    expect(plan.pull).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.base.b1.title).toBe("Appka");
  });

  it("bez základu (první běh) nic nepřebírá a kalendář srovná podle appky", () => {
    const plan = planMirror([item()], [ev("1", { title: "Google" })], {}, H);
    expect(plan.pull).toEqual([]);
    expect(plan.update).toHaveLength(1);
  });

  it("prázdný název z kalendáře nepřebere", () => {
    const plan = planMirror([item()], [ev("1", { title: "" })], base("1"), H);
    expect(plan.pull).toEqual([]);
    // základ = kalendář, takže příští běh název vrátí
    const next = planMirror([item()], [ev("1", { title: "" })], plan.base, H);
    expect(next.update).toHaveLength(1);
  });

  it("celodenní událost čas bloku nepřepíše a příští běh ji vrátí na čas", () => {
    const allDay = ev("1", { allDay: true, startDate: 0, endDate: 1440 * MIN });
    const plan = planMirror([item()], [allDay], base("1"), H);
    expect(plan.pull).toEqual([]);
    const next = planMirror([item()], [allDay], plan.base, H);
    expect(next.update).toEqual([{ ...item(), id: "1" }]);
  });

  it("smazání v kalendáři se převezme", () => {
    const plan = planMirror([item()], [], base("1"), H);
    expect(plan.pull).toEqual([{ key: "b1", kind: "block", deleted: true }]);
    expect(plan.create).toEqual([]);
  });

  it("když zmizí skoro všechno naráz, nic se nemaže a založí se znovu", () => {
    const items = ["b1", "b2", "b3"].map((key) => item({ key }));
    const known = Object.fromEntries(
      items.map((i, n) => [i.key, { eventId: String(n), title: "Psaní", startDate: 100 * MIN, endDate: 200 * MIN }]),
    );
    const plan = planMirror(items, [], known, H);
    expect(plan.pull).toEqual([]);
    expect(plan.create).toHaveLength(3);
  });

  it("dvě smazané ze čtyř jsou vědomé mazání", () => {
    const items = ["b1", "b2", "b3", "b4"].map((key) => item({ key }));
    const known = Object.fromEntries(
      items.map((i, n) => [i.key, { eventId: String(n), title: "Psaní", startDate: 100 * MIN, endDate: 200 * MIN }]),
    );
    const plan = planMirror(items, [ev("2", { key: "b3" }), ev("3", { key: "b4" })], known, H);
    expect(plan.pull.map((p) => [p.key, p.deleted])).toEqual([
      ["b1", true],
      ["b2", true],
    ]);
  });

  it("událost bez protějšku smaže, historii a duplikát pozná", () => {
    const from = 1000 * MIN;
    const plan = planMirror(
      [item({ startDate: 2000 * MIN, endDate: 2100 * MIN })],
      [
        ev("10", { startDate: 2000 * MIN, endDate: 2100 * MIN }),
        ev("11", { startDate: 2000 * MIN, endDate: 2100 * MIN }), // duplikát
        ev("12", { key: "smazany", startDate: 1500 * MIN, endDate: 1600 * MIN }),
        ev("13", { key: "minuly", startDate: 10 * MIN, endDate: 20 * MIN }),
        ev("14", { key: "stary", startDate: 10 * MIN, endDate: 20 * MIN }),
        ev("15", { key: "znamy", startDate: 10 * MIN, endDate: 20 * MIN }),
      ],
      { znamy: { eventId: "15", title: "Psaní", startDate: 10 * MIN, endDate: 20 * MIN } },
      { from, pastKeys: new Set(["minuly"]) },
    );
    // 11 duplikát, 12 smazaný blok, 15 položka, která v appce už není a základ ji zná
    expect(plan.remove.sort()).toEqual(["11", "12", "15"]);
  });
});

describe("applyPulls", () => {
  function fakeApi(state: MicroWinsState) {
    const calls: unknown[][] = [];
    const api: MirrorApi = {
      updateBlock: (...args) => void calls.push(["updateBlock", ...args]),
      toggleBlockDone: (...args) => void calls.push(["toggleBlockDone", ...args]),
      deleteBlock: (id) => {
        calls.push(["deleteBlock", id]);
        return state.timeBlocks.find((b) => b.id === id) ?? null;
      },
      renameEverywhere: (...args) => void calls.push(["renameEverywhere", ...args]),
      setPriority: (...args) => void calls.push(["setPriority", ...args]),
      renameTodo: (...args) => void calls.push(["renameTodo", ...args]),
      toggleTodo: (...args) => void calls.push(["toggleTodo", ...args]),
      setTodoDue: (...args) => void calls.push(["setTodoDue", ...args]),
    };
    return { api, calls };
  }

  it("blok: přejmenování, posun a odškrtnutí stejnými akcemi jako z UI", () => {
    const { state, block } = addBlock(EMPTY_STATE, { date: DAY, start: 540, duration: 30, title: "Psaní" }, NOON);
    const { api, calls } = fakeApi(state);
    const start = dayStartMs("2026-10-30") + 10 * 60 * MIN;
    applyPulls(state, [{ key: block.id, kind: "block", title: "Psaní knihy", done: true, startDate: start, endDate: start + 90 * MIN }], api);
    expect(calls).toEqual([
      ["updateBlock", block.id, { title: "Psaní knihy" }],
      ["updateBlock", block.id, { date: "2026-10-30", start: 600, duration: 90 }],
      ["toggleBlockDone", block.id],
    ]);
  });

  it("blok z ToDo se přejmenuje v ToDo", () => {
    const added = addTodo(EMPTY_STATE, "zavolat", NOON);
    const { state, block } = addBlock(
      added.state,
      { date: DAY, start: 540, title: "zavolat", todoId: added.todo!.id },
      NOON,
    );
    const { api, calls } = fakeApi(state);
    applyPulls(state, [{ key: block.id, kind: "block", title: "zavolat mámě" }], api);
    expect(calls).toEqual([["renameTodo", added.todo!.id, "zavolat mámě"]]);
  });

  it("blok smazaný v kalendáři smaže a vrátí ho pro „Vrátit“", () => {
    const { state, block } = addBlock(EMPTY_STATE, { date: DAY, start: 540, title: "Psaní" }, NOON);
    const { api, calls } = fakeApi(state);
    const out = applyPulls(state, [{ key: block.id, kind: "block", deleted: true }], api);
    expect(calls).toEqual([["deleteBlock", block.id]]);
    expect(out.blocks.map((b) => b.id)).toEqual([block.id]);
  });

  it("odškrtnutí, které už platí, se neopakuje", () => {
    const { state, block } = addBlock(EMPTY_STATE, { date: DAY, start: 540, title: "Psaní" }, NOON);
    const { api, calls } = fakeApi(state);
    applyPulls(state, [{ key: block.id, kind: "block", done: false }], api);
    expect(calls).toEqual([]);
  });

  it("ToDo: posun termínu, a smazání či ✓ ho odškrtne", () => {
    const added = addTodo(EMPTY_STATE, "autoškola", NOON);
    const state = setTodoDue(added.state, added.todo!.id, "2026-11-06", "08:00");
    const id = added.todo!.id;
    const { api, calls } = fakeApi(state);
    const start = dayStartMs("2026-11-07") + (9 * 60 + 15) * MIN;
    const out = applyPulls(state, [{ key: id, kind: "todo", startDate: start, endDate: start + 30 * MIN }, { key: id, kind: "todo", deleted: true }], api);
    expect(calls).toEqual([
      ["setTodoDue", id, "2026-11-07", "09:15"],
      ["toggleTodo", id],
    ]);
    expect(out.todos.map((t) => t.id)).toEqual([id]);
  });

  it("hotové ToDo ani neznámá věc nic nedělají", () => {
    const added = addTodo(EMPTY_STATE, "hotovo", NOON);
    const state = toggleTodo(added.state, added.todo!.id, NOON);
    const { api, calls } = fakeApi(state);
    applyPulls(state, [{ key: added.todo!.id, kind: "todo", deleted: true }, { key: "nic", kind: "block", deleted: true }], api);
    expect(calls).toEqual([]);
  });
});
