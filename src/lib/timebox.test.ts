import { describe, expect, it } from "vitest";
import { isValidISODate } from "./date";
import { addBlock } from "./timeblocks";
import {
  isSheetEmpty,
  normalizeSheet,
  setBrainDump,
  setPriority,
  sheetOf,
  slotContent,
  slotStart,
  timeboxRowCount,
  timeboxRows,
} from "./timebox";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const DAY = "2026-09-27";
const NEXT = "2026-09-28";

describe("mřížka time boxu", () => {
  it("jde od první hodiny k poslední", () => {
    const rows = timeboxRows(DAY, 5, 23);

    expect(rows).toHaveLength(19);
    expect(rows[0]).toEqual({ hour: 5, date: DAY });
    expect(rows.at(-1)).toEqual({ hour: 23, date: DAY });
  });

  it("rozsah přes půlnoc posílá ranní hodiny na další den", () => {
    const rows = timeboxRows(DAY, 22, 1);

    expect(rows.map((r) => `${r.hour}@${r.date}`)).toEqual([
      `22@${DAY}`,
      `23@${DAY}`,
      `0@${NEXT}`,
      `1@${NEXT}`,
    ]);
    expect(timeboxRowCount(22, 1)).toBe(4);
  });

  it("nesmyslná hodina se srovná do dne", () => {
    expect(timeboxRows(DAY, -5, 30)).toHaveLength(24);
    expect(slotStart(9, true)).toBe(9 * 60 + 30);
  });
});

describe("políčka mřížky a bloky plánu", () => {
  const withBlocks = (...inputs: { start: number; duration: number; title?: string }[]) => {
    let state: MicroWinsState = EMPTY_STATE;
    for (const input of inputs) state = addBlock(state, { date: DAY, ...input }).state;
    return state.timeBlocks;
  };

  it("blok padá do políčka, ve kterém začíná - i když začal o čtvrt hodiny dřív", () => {
    const blocks = withBlocks({ start: 9 * 60 + 15, duration: 30 });

    expect(slotContent(blocks, slotStart(9, false)).blocks).toHaveLength(1);
    expect(slotContent(blocks, slotStart(9, true)).blocks).toHaveLength(0);
  });

  it("delší blok se v dalších políčkách jen táhne", () => {
    const blocks = withBlocks({ start: 9 * 60, duration: 90 });

    expect(slotContent(blocks, slotStart(9, false)).blocks).toHaveLength(1);
    const next = slotContent(blocks, slotStart(9, true));
    expect(next.blocks).toHaveLength(0);
    expect(next.running?.start).toBe(9 * 60);
    // 10:30 už je konec bloku, tam se netáhne nic.
    expect(slotContent(blocks, slotStart(10, true)).running).toBe(null);
  });

  it("dvě věci ve stejné půlhodině stojí obě", () => {
    const blocks = withBlocks(
      { start: 10 * 60, duration: 30, title: "první" },
      { start: 10 * 60 + 15, duration: 15, title: "druhá" },
    );

    expect(slotContent(blocks, 10 * 60).blocks.map((b) => b.title)).toEqual(["první", "druhá"]);
  });
});

describe("list dne", () => {
  it("den bez listu se tváří prázdně a má tři priority", () => {
    const sheet = sheetOf(EMPTY_STATE, DAY);

    expect(sheet.priorities).toEqual(["", "", ""]);
    expect(isSheetEmpty(sheet)).toBe(true);
  });

  it("priority i brain dump se drží u svého dne", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, DAY, 1, "Zavolat bance");
    s = setBrainDump(s, DAY, "nápady");
    s = setPriority(s, NEXT, 0, "zítřek");

    expect(sheetOf(s, DAY).priorities).toEqual(["", "Zavolat bance", ""]);
    expect(sheetOf(s, DAY).brainDump).toBe("nápady");
    expect(sheetOf(s, NEXT).priorities[0]).toBe("zítřek");
    expect(s.daySheets).toHaveLength(2);
  });

  it("prázdný zápis řádek nezaloží a vygumovaný ho zase sundá", () => {
    expect(setPriority(EMPTY_STATE, DAY, 0, "   ")).toBe(EMPTY_STATE);

    const written = setPriority(EMPTY_STATE, DAY, 0, "něco");
    expect(written.daySheets).toHaveLength(1);
    expect(setPriority(written, DAY, 0, "").daySheets).toHaveLength(0);
  });

  it("stejný text stavem nehne", () => {
    const s = setPriority(EMPTY_STATE, DAY, 0, "něco");

    expect(setPriority(s, DAY, 0, "něco")).toBe(s);
    expect(setPriority(s, DAY, 9, "mimo")).toBe(s);
  });

  it("z uložených dat se počet priorit srovná na tři", () => {
    const sheet = normalizeSheet(
      { date: DAY, priorities: ["a", "b", "c", "d"], brainDump: 5 },
      isValidISODate,
    );

    expect(sheet?.priorities).toEqual(["a", "b", "c"]);
    expect(sheet?.brainDump).toBe("");
    // Nesmyslné datum ani prázdný list se nenačítají.
    expect(normalizeSheet({ date: "kdysi", priorities: ["a"] }, isValidISODate)).toBe(null);
    expect(normalizeSheet({ date: DAY, priorities: [] }, isValidISODate)).toBe(null);
  });
});
