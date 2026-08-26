import { describe, expect, it } from "vitest";
import {
  blankDueRule,
  DEFAULT_DUE_RULES,
  describeDueRule,
  DUE_RULE_MAX,
  parseDueRules,
  resolveDueRule,
  type DueRule,
} from "./due-rules";

/** Středa 26. 8. 2026, 10:00 v místním čase. */
const WED = new Date(2026, 7, 26, 10, 0, 0);
/** Sobota 29. 8. 2026 - ve dvou časech, sedm ráno a devět. */
const SAT_EARLY = new Date(2026, 7, 29, 7, 0, 0);
const SAT_LATE = new Date(2026, 7, 29, 9, 0, 0);

function rule(patch: Partial<DueRule>): DueRule {
  return {
    id: "r",
    label: "Test",
    kind: "day",
    minutes: 60,
    days: 0,
    weekday: 6,
    time: null,
    ...patch,
  };
}

describe("za chvíli", () => {
  it("přičte minuty k současnému času", () => {
    expect(resolveDueRule(rule({ kind: "offset", minutes: 60 }), WED)).toEqual({
      date: "2026-08-26",
      time: "11:00",
    });
    expect(resolveDueRule(rule({ kind: "offset", minutes: 25 }), WED).time).toBe("10:25");
  });

  /* Za hodinu o půl dvanácté v noci je zítra - datum se musí přepočítat taky,
     ne jen hodina. */
  it("přes půlnoc přeteče do dalšího dne", () => {
    const night = new Date(2026, 7, 26, 23, 30, 0);

    expect(resolveDueRule(rule({ kind: "offset", minutes: 60 }), night)).toEqual({
      date: "2026-08-27",
      time: "00:30",
    });
  });
});

describe("za N dní", () => {
  it("nula je dnes, jednička zítra", () => {
    expect(resolveDueRule(rule({ days: 0, time: "18:00" }), WED)).toEqual({
      date: "2026-08-26",
      time: "18:00",
    });
    expect(resolveDueRule(rule({ days: 1, time: "09:00" }), WED)).toEqual({
      date: "2026-08-27",
      time: "09:00",
    });
  });

  /* "Dnes večer" v deset večer vyjde na dnešek, i když je to za chvíli za
     námi. Přeskočit tiše na zítřek by lhalo: na tlačítku je napsáno "dnes". */
  it("hodinu, která už byla, neposouvá na zítřek", () => {
    const evening = new Date(2026, 7, 26, 22, 0, 0);

    expect(resolveDueRule(rule({ days: 0, time: "18:00" }), evening).date).toBe("2026-08-26");
  });

  it("bez hodiny zůstane termín na celý den", () => {
    expect(resolveDueRule(rule({ days: 2, time: null }), WED)).toEqual({
      date: "2026-08-28",
      time: null,
    });
  });
});

describe("nejbližší den v týdnu", () => {
  const saturday = rule({ kind: "weekday", weekday: 6, time: "08:00" });

  it("ve středu míří na nejbližší sobotu", () => {
    expect(resolveDueRule(saturday, WED)).toEqual({ date: "2026-08-29", time: "08:00" });
  });

  /*
   * Tohle je celý vtip pravidla: v sobotu ráno je nejbližší sobota **dnešek**,
   * dokud osmá nebyla. O dvě hodiny později už je to sobota za týden - jinak
   * by tlačítko vyrobilo termín v minulosti.
   */
  it("v sobotu ráno je nejbližší sobota dnešek", () => {
    expect(resolveDueRule(saturday, SAT_EARLY).date).toBe("2026-08-29");
  });

  it("po zadané hodině přeskočí na sobotu za týden", () => {
    expect(resolveDueRule(saturday, SAT_LATE).date).toBe("2026-09-05");
  });

  it("bez hodiny platí dnešek celý den", () => {
    const anyTime = rule({ kind: "weekday", weekday: 6, time: null });

    expect(resolveDueRule(anyTime, SAT_LATE).date).toBe("2026-08-29");
  });

  it("pondělí ze středy je až příští týden", () => {
    const monday = rule({ kind: "weekday", weekday: 1, time: "09:00" });

    expect(resolveDueRule(monday, WED).date).toBe("2026-08-31");
  });
});

describe("popis pravidla", () => {
  it("řekne česky, co tlačítko udělá", () => {
    expect(describeDueRule(rule({ kind: "offset", minutes: 90 }))).toBe("za 1 h 30 min od teď");
    expect(describeDueRule(rule({ days: 0, time: "18:00" }))).toBe("dnes v 18:00");
    expect(describeDueRule(rule({ days: 1, time: "09:00" }))).toBe("zítra v 9:00");
    expect(describeDueRule(rule({ kind: "weekday", weekday: 6, time: "08:00" }))).toBe(
      "nejbližší sobota v 8:00",
    );
    expect(describeDueRule(rule({ days: 0, time: null }))).toBe("dnes, bez hodiny");
  });
});

describe("načtení z uložených dat", () => {
  it("výchozí nabídka projde beze změny", () => {
    expect(parseDueRules(DEFAULT_DUE_RULES)).toEqual(DEFAULT_DUE_RULES);
  });

  /* Prázdný ani rozbitý seznam se nesmí propsat do dialogu - nabídka bez
     jediného tlačítka vypadá jako chyba appky. */
  it("nesmysl i prázdno spadne na výchozí nabídku", () => {
    expect(parseDueRules("hodně")).toEqual(DEFAULT_DUE_RULES);
    expect(parseDueRules([])).toEqual(DEFAULT_DUE_RULES);
    expect(parseDueRules([{ kind: "nesmysl" }, null, 5])).toEqual(DEFAULT_DUE_RULES);
  });

  it("chybějící a nesmyslné hodnoty se srovnají do mezí", () => {
    const [parsed] = parseDueRules([{ label: "Divné", kind: "weekday", weekday: 99, time: "25:00" }]);

    expect(parsed.weekday).toBe(6);
    expect(parsed.time).toBeNull();
    expect(parsed.label).toBe("Divné");
  });

  it("víc tlačítek, než se vejde, se ořízne", () => {
    const many = Array.from({ length: DUE_RULE_MAX + 5 }, (_, i) => ({
      ...blankDueRule(`r${i}`),
    }));

    expect(parseDueRules(many)).toHaveLength(DUE_RULE_MAX);
  });
});
