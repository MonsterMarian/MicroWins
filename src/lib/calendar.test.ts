import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@ebarooni/capacitor-calendar";
import {
  dayEvents,
  dayStartMs,
  describeBlock,
  desiredEvent,
  markerOf,
  planCalendarSync,
  syncWindow,
  type DesiredEvent,
} from "./calendar";
import { EMPTY_STATE, type TimeBlock } from "./types";

const MIN = 60_000;

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

function block(patch: Partial<TimeBlock>): TimeBlock {
  return {
    id: "b1",
    date: "2026-10-29",
    start: 9 * 60,
    duration: 30,
    title: "Psaní",
    todoId: null,
    taskId: null,
    priorityId: null,
    createdAt: "2026-10-29T08:00:00.000Z",
    doneAt: null,
    ...patch,
  };
}

describe("dayEvents", () => {
  const day = "2026-10-29";
  const at = (minutes: number, date = day) => dayStartMs(date) + minutes * MIN;

  it("přepočte událost na minuty od půlnoci", () => {
    const [e] = dayEvents([event({ startDate: at(9 * 60 + 15), endDate: at(10 * 60) })], day);
    expect(e).toMatchObject({ start: 555, duration: 45, allDay: false });
  });

  it("událost přes půlnoc ořízne na den", () => {
    const night = event({ startDate: at(23 * 60, "2026-10-28"), endDate: at(60) });
    expect(dayEvents([night], day)[0]).toMatchObject({ start: 0, duration: 60 });
    expect(dayEvents([night], "2026-10-28")[0]).toMatchObject({ start: 23 * 60, duration: 60 });
  });

  it("vynechá události jiných dnů", () => {
    expect(dayEvents([event({ startDate: at(-60), endDate: at(0) })], day)).toEqual([]);
  });

  it("celodenní událost čte v UTC a konec bere výlučně", () => {
    const allDay = event({
      isAllDay: true,
      startDate: Date.UTC(2026, 9, 29),
      endDate: Date.UTC(2026, 9, 31),
    });
    expect(dayEvents([allDay], "2026-10-29")[0]?.allDay).toBe(true);
    expect(dayEvents([allDay], "2026-10-30")).toHaveLength(1);
    expect(dayEvents([allDay], "2026-10-31")).toEqual([]);
  });
});

describe("značka v popisu", () => {
  it("najde id bloku a cizí popis ignoruje", () => {
    expect(markerOf(describeBlock("blk_x1_ab-c"))).toBe("blk_x1_ab-c");
    expect(markerOf("Schůzka s microwins týmem")).toBeNull();
    expect(markerOf(null)).toBeNull();
  });
});

describe("desiredEvent", () => {
  it("převede blok na čas a odškrtnutý označí", () => {
    const want = desiredEvent(EMPTY_STATE, block({ doneAt: "2026-10-29T10:00:00.000Z" }));
    expect(want.startDate).toBe(dayStartMs("2026-10-29") + 9 * 60 * MIN);
    expect(want.endDate - want.startDate).toBe(30 * MIN);
    expect(want.title).toBe("✓ Psaní");
  });
});

describe("planCalendarSync", () => {
  const want: DesiredEvent = { blockId: "b1", title: "Psaní", startDate: 100, endDate: 200 };
  const mine = (id: string, blockId: string, patch: Partial<CalendarEvent> = {}) =>
    event({ id, title: "Psaní", startDate: 100, endDate: 200, description: describeBlock(blockId), ...patch });

  it("chybějící událost založí", () => {
    expect(planCalendarSync([want], [])).toEqual({ create: [want], update: [], remove: [] });
  });

  it("stejnou nechá být", () => {
    expect(planCalendarSync([want], [mine("e1", "b1")])).toEqual({ create: [], update: [], remove: [] });
  });

  it("posunutou nebo přejmenovanou upraví", () => {
    const plan = planCalendarSync([want], [mine("e1", "b1", { startDate: 50 })]);
    expect(plan.update).toEqual([{ ...want, id: "e1" }]);
  });

  it("událost smazaného bloku i duplikát smaže, cizí nechá", () => {
    const plan = planCalendarSync(
      [want],
      [mine("e1", "b1"), mine("e2", "b1"), mine("e3", "gone"), event({ id: "e4" })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.remove.sort()).toEqual(["e2", "e3"]);
  });
});

describe("syncWindow", () => {
  it("od včerejška dva týdny dopředu", () => {
    expect(syncWindow("2026-10-29")).toEqual({ from: "2026-10-28", to: "2026-11-12" });
  });
});
