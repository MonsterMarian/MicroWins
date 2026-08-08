import { describe, expect, it } from "vitest";
import { achievedMilestones, nextMilestones, winMilestones } from "./milestones";
import { EMPTY_STATE, type MicroWinsState, type Microwin } from "./types";

function win(date: string, i: number): Microwin {
  return {
    id: `w${i}`,
    metricId: "m1",
    date,
    value: 1,
    previousRecord: 0,
    firstEver: i === 0,
    createdAt: `${date}T10:0${i % 10}:00.000Z`,
  };
}

function stateWith(dates: string[]): MicroWinsState {
  return { ...EMPTY_STATE, microwins: dates.map((d, i) => win(d, i)) };
}

const find = (s: MicroWinsState, id: string) => winMilestones(s).find((m) => m.id === id)!;

describe("winMilestones", () => {
  it("prázdný stav nemá nic splněno", () => {
    expect(achievedMilestones(EMPTY_STATE)).toHaveLength(0);
    expect(winMilestones(EMPTY_STATE).every((m) => !m.achieved)).toBe(true);
  });

  it("první microwin splní milník total-1 a zná jeho den", () => {
    const s = stateWith(["2026-01-01"]);
    const m = find(s, "total-1");
    expect(m.achieved).toBe(true);
    expect(m.achievedOn).toBe("2026-01-01");
    expect(m.label).toBe("První microwin");
  });

  it("total-5 padne v den pátého microwinu, ne posledního", () => {
    const s = stateWith([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-02-20",
    ]);
    const m = find(s, "total-5");
    expect(m.achieved).toBe(true);
    expect(m.achievedOn).toBe("2026-01-05");
    expect(m.current).toBe(6);
  });

  it("série se počítá jen po sobě jdoucí dny", () => {
    // 3 dny v řadě, pak díra, pak 2 dny
    const s = stateWith([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-10",
      "2026-03-11",
    ]);
    expect(find(s, "streak-3").achieved).toBe(true);
    expect(find(s, "streak-3").achievedOn).toBe("2026-03-03");
    expect(find(s, "streak-7").achieved).toBe(false);
    expect(find(s, "streak-7").achievedOn).toBeNull();
  });

  it("dva microwiny v jednom dni jsou jeden aktivní den, ale dva do celkového počtu", () => {
    const s = stateWith(["2026-04-01", "2026-04-01"]);
    expect(find(s, "total-1").current).toBe(2);
    expect(find(s, "days-10").current).toBe(1);
    expect(find(s, "streak-3").current).toBe(1);
  });

  it("nextMilestones vrací nejbližší nesplněný z každého druhu", () => {
    const s = stateWith(["2026-05-01", "2026-05-02", "2026-05-03"]);
    const next = nextMilestones(s);
    expect(next.map((m) => m.id)).toEqual(["total-5", "streak-7", "days-10"]);
    expect(next[0].current).toBe(3);
  });

  it("achievedMilestones řadí naposledy dosažené první", () => {
    const s = stateWith(["2026-01-01", "2026-06-01"]);
    const done = achievedMilestones(s);
    expect(done[0].id).toBe("total-1");
    expect(done[0].achievedOn).toBe("2026-01-01");
    // jediný splněný - druhý milník (total-5) ještě nepadl
    expect(done).toHaveLength(1);
  });
});
