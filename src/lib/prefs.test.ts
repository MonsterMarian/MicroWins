import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADDONS,
  DEFAULT_PREFS,
  DEFAULT_TAB_ORDER,
  parsePrefs,
  parseAddons,
  parseTabOrder,
  todoTtlMs,
} from "./prefs";

/* Očekávání jedou z `DEFAULT_TAB_ORDER`, ne z ručně vypsaného seznamu - další
   záložka v appce jinak shodí testy, které o ní nic nevědí a vědět nemusí. */
const LAST = DEFAULT_TAB_ORDER[DEFAULT_TAB_ORDER.length - 1];
const rest = (...used: string[]) => DEFAULT_TAB_ORDER.filter((t) => !used.includes(t));

describe("pořadí záložek", () => {
  it("uložené pořadí projde beze změny", () => {
    const saved = [...DEFAULT_TAB_ORDER].reverse();

    expect(parseTabOrder(saved)).toEqual(saved);
  });

  it("chybějící záložka se doplní na konec", () => {
    expect(parseTabOrder([LAST])).toEqual([LAST, ...rest(LAST)]);
  });

  it("neznámé a zdvojené položky vypadnou", () => {
    expect(parseTabOrder([LAST, "pushwin", LAST, DEFAULT_TAB_ORDER[0]])).toEqual([
      LAST,
      DEFAULT_TAB_ORDER[0],
      ...rest(LAST, DEFAULT_TAB_ORDER[0]),
    ]);
  });

  it("nesmysl místo seznamu spadne na výchozí pořadí", () => {
    expect(parseTabOrder("todo")).toEqual(DEFAULT_TAB_ORDER);
    expect(parseTabOrder(undefined)).toEqual(DEFAULT_TAB_ORDER);
  });
});

describe("mizení v ToDo", () => {
  it("výchozí je šest hodin", () => {
    expect(todoTtlMs(DEFAULT_PREFS)).toBe(6 * 60 * 60 * 1000);
  });

  /* Nula je dohodnutá řeč pro "nemaže se" - viz `ttlOff` v `lib/todos.ts`.
     Doba přitom zůstane uložená, aby ji zpětné zapnutí vrátilo. */
  it("vypnuté mizení je nula, ale nastavená doba se pamatuje", () => {
    const prefs = { ...DEFAULT_PREFS, todoExpire: false, todoTtlMinutes: 30 };

    expect(todoTtlMs(prefs)).toBe(0);
    expect(todoTtlMs({ ...prefs, todoExpire: true })).toBe(30 * 60_000);
  });

  it("nesmyslná doba ze zálohy spadne do mezí", () => {
    expect(parsePrefs({ todoTtlMinutes: -5 }).todoTtlMinutes).toBe(1);
    expect(parsePrefs({ todoTtlMinutes: "hodně" }).todoTtlMinutes).toBe(
      DEFAULT_PREFS.todoTtlMinutes,
    );
  });

  /* Nastavení ze starší verze o mizení nic neříká - a to se nesmí přečíst
     jako "vypnout", jinak by uživateli po aktualizaci přestaly mizet položky. */
  it("chybějící volba nechává mizení zapnuté", () => {
    expect(parsePrefs({ accent: "white" }).todoExpire).toBe(true);
  });
});

/* Očekávání jedou z `DEFAULT_ADDONS`, ne z ručně vypsaného seznamu - další
   addon v `prefs.ts` jinak shodí testy, které o něm nic nevědí a vědět nemusí. */
describe("addony", () => {
  it("vypnutý addon se přečte jako vypnutý", () => {
    expect(parseAddons({ todo: false })).toEqual({ ...DEFAULT_ADDONS, todo: false });
  });

  /* Nový addon v appce chybí ve starém uloženém nastavení. Kdyby se bral jako
     vypnutý, přišel by uživatel po aktualizaci o kus appky, o kterém nic neřekl. */
  it("addon, který v uloženém nastavení není, je zapnutý", () => {
    expect(parseAddons({})).toEqual(DEFAULT_ADDONS);
    expect(parseAddons(null)).toEqual(DEFAULT_ADDONS);
  });
});

describe("nastavení ze starší verze", () => {
  it("zrušené volby se zahodí a zbytek se dočte", () => {
    const prefs = parsePrefs({
      accent: "white",
      doneStyle: "stamp",
      pushWins: true,
      pushOdds: { easy: 1, medium: 1, hard: 1 },
    });

    expect(prefs).toEqual({ ...DEFAULT_PREFS, accent: "white" });
  });
});
