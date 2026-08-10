import { describe, expect, it } from "vitest";
import { LUCIDE_ICONS } from "@/components/ui/lucide-map";
import {
  EMOJI_GROUPS,
  LUCIDE_GROUPS,
  filterGroups,
  flattenGroups,
  lucideNameOf,
  lucideRef,
  normalizeQuery,
} from "./icons";

describe("katalog ikon", () => {
  it("každá kreslená ikona z katalogu má komponentu", () => {
    const missing = flattenGroups(LUCIDE_GROUPS)
      .map((i) => i.value)
      .filter((name) => !(name in LUCIDE_ICONS));
    expect(missing).toEqual([]);
  });

  it("v mapě nezůstávají komponenty bez položky v katalogu", () => {
    const known = new Set(flattenGroups(LUCIDE_GROUPS).map((i) => i.value));
    expect(Object.keys(LUCIDE_ICONS).filter((n) => !known.has(n))).toEqual([]);
  });

  it("nabídne aspoň 400 ikon dohromady", () => {
    const total = flattenGroups(EMOJI_GROUPS).length + flattenGroups(LUCIDE_GROUPS).length;
    expect(total).toBeGreaterThanOrEqual(400);
  });

  it("žádná ikona se neopakuje", () => {
    for (const groups of [EMOJI_GROUPS, LUCIDE_GROUPS]) {
      const values = flattenGroups(groups).map((i) => i.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("klíčová slova jsou bez diakritiky, jinak by je hledání nenašlo", () => {
    for (const groups of [EMOJI_GROUPS, LUCIDE_GROUPS]) {
      for (const item of flattenGroups(groups)) {
        expect(normalizeQuery(item.keywords)).toBe(item.keywords);
      }
    }
  });
});

describe("odkaz na ikonu", () => {
  it("emoji zůstává emoji, kreslená má předponu", () => {
    expect(lucideNameOf("💪")).toBeNull();
    expect(lucideNameOf(lucideRef("Dumbbell"))).toBe("Dumbbell");
  });
});

describe("hledání", () => {
  it("bere dotaz s diakritikou i bez ní", () => {
    for (const query of ["káva", "kava", "KÁVA"]) {
      const hit = filterGroups(EMOJI_GROUPS, query);
      expect(flattenGroups(hit).map((i) => i.value)).toContain("☕");
    }
  });

  it("prázdný dotaz vrátí celý katalog", () => {
    expect(filterGroups(LUCIDE_GROUPS, "  ")).toBe(LUCIDE_GROUPS);
  });

  it("na nesmysl nevrátí nic", () => {
    expect(filterGroups(EMOJI_GROUPS, "xyzzy")).toEqual([]);
  });

  it("najde i podle emoji znaku samotného", () => {
    expect(flattenGroups(filterGroups(EMOJI_GROUPS, "💪")).map((i) => i.value)).toEqual(["💪"]);
  });
});
