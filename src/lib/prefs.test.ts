import { describe, expect, it } from "vitest";
import { DEFAULT_ADDONS, DEFAULT_PREFS, parsePrefs, parseAddons, parseTabOrder } from "./prefs";

describe("pořadí záložek", () => {
  it("uložené pořadí projde beze změny", () => {
    expect(parseTabOrder(["projects", "todo", "overview"])).toEqual([
      "projects",
      "todo",
      "overview",
    ]);
  });

  it("chybějící záložka se doplní na konec", () => {
    expect(parseTabOrder(["projects"])).toEqual(["projects", "overview", "todo"]);
  });

  it("neznámé a zdvojené položky vypadnou", () => {
    expect(parseTabOrder(["projects", "pushwin", "projects", "todo", "overview"])).toEqual([
      "projects",
      "todo",
      "overview",
    ]);
  });

  it("nesmysl místo seznamu spadne na výchozí pořadí", () => {
    expect(parseTabOrder("todo")).toEqual(["overview", "todo", "projects"]);
    expect(parseTabOrder(undefined)).toEqual(["overview", "todo", "projects"]);
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
