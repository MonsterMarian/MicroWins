import { describe, expect, it } from "vitest";
import { isOlderBundle } from "./live-update";

/** Verze tak, jak ji dělá scripts/release.mjs. */
const version = (iso: string) => new Date(iso).toISOString().replace(/[-:T]/g, ".").slice(0, 16);

describe("isOlderBundle", () => {
  it("starší balík pozná i přes hranici dne, měsíce a roku", () => {
    expect(isOlderBundle("2026.10.14.12.36", "2026.10.29.10.24")).toBe(true);
    expect(isOlderBundle(version("2026-09-30T23:59:00Z"), version("2026-10-01T00:00:00Z"))).toBe(true);
    expect(isOlderBundle(version("2025-12-31T23:59:00Z"), version("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isOlderBundle(version("2026-10-29T09:05:00Z"), version("2026-10-29T10:00:00Z"))).toBe(true);
  });

  it("stejný ani novější balík starší není", () => {
    expect(isOlderBundle("2026.10.29.11.10", "2026.10.29.11.10")).toBe(false);
    expect(isOlderBundle("2026.10.29.11.10", "2026.10.14.12.36")).toBe(false);
  });

  it("bez verze k porovnání (vývojový build) nic nezahazuje", () => {
    expect(isOlderBundle("2026.10.14.12.36", undefined)).toBe(false);
    expect(isOlderBundle("2026.10.14.12.36", null)).toBe(false);
  });

  it("formát verze má nuly, jinak by textové porovnání lhalo", () => {
    expect(version("2026-01-02T03:04:00Z")).toBe("2026.01.02.03.04");
  });
});
