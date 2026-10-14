import { describe, expect, it } from "vitest";
import { isValidISODate } from "./date";
import { addBlock, blockTitle, linkBlockToPriority, moveBlockToDay } from "./timeblocks";
import {
  deleteEverywhere,
  hasPriorityBlockAt,
  isSheetEmpty,
  markPriorityCarried,
  normalizeSheet,
  parseDumpTime,
  placeCount,
  placesOf,
  priorityRef,
  releaseCarriedBlock,
  renameEverywhere,
  restoreEverywhere,
  setBrainDump,
  setPriority,
  sheetOf,
  splitDumpSchedule,
  swapPriorities,
  toggleBlockDone,
  togglePriority,
  slotContent,
  slotChoices,
  slotStart,
  timeboxRowCount,
  timeboxRows,
  timeboxSlots,
  unfinishedCarryovers,
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

/* Hlavní věc dne přetažená do mřížky je tatáž věc ze dvou stran - musí se
   chovat jako termín v ToDo a blok v plánu. */
describe("priorita a blok z ní", () => {
  const NOON = new Date("2026-09-27T12:00:00");

  function linked() {
    const withPriority = setPriority(EMPTY_STATE, DAY, 0, "Zavolat bance");
    const { state, block } = addBlock(
      withPriority,
      {
        date: DAY,
        start: 9 * 60,
        duration: 30,
        title: "Zavolat bance",
        priorityId: priorityRef(DAY, 0),
      },
      NOON,
    );
    return { state, blockId: block.id };
  }

  it("blok si bere text priority, takže přejmenování se propíše", () => {
    const { state } = linked();

    const renamed = setPriority(state, DAY, 0, "Zavolat do banky");
    expect(blockTitle(renamed, renamed.timeBlocks[0])).toBe("Zavolat do banky");
  });

  it("odškrtnutí platí na obou stranách", () => {
    const { state, blockId } = linked();

    const fromBlock = toggleBlockDone(state, blockId, NOON);
    expect(sheetOf(fromBlock, DAY).priorities[0].done).toBe(true);
    expect(fromBlock.timeBlocks[0].doneAt).not.toBeNull();

    const fromPriority = togglePriority(fromBlock, DAY, 0, NOON);
    expect(sheetOf(fromPriority, DAY).priorities[0].done).toBe(false);
    expect(fromPriority.timeBlocks[0].doneAt).toBeNull();
  });

  it("vygumovaná priorita nechá bloku jeho vlastní text", () => {
    const { state } = linked();

    const cleared = setPriority(state, DAY, 0, "");
    expect(blockTitle(cleared, cleared.timeBlocks[0])).toBe("Zavolat bance");
    // Prázdnou prioritu nejde odškrtnout, takže se nehne ani blok.
    expect(togglePriority(cleared, DAY, 0, NOON)).toBe(cleared);
  });

  it("prohození hlavních věcí vezme s sebou i bloky, které z nich vznikly", () => {
    const { state, blockId } = linked();
    const withThird = setPriority(state, DAY, 2, "Uklidit stůl");

    const swapped = swapPriorities(withThird, DAY, 0, 2);
    expect(sheetOf(swapped, DAY).priorities.map((p) => p.text)).toEqual([
      "Uklidit stůl",
      "",
      "Zavolat bance",
    ]);
    // Blok visí na tom, s čím se přesunul - ne na cizím textu na starém místě.
    expect(swapped.timeBlocks[0].priorityId).toBe(`${DAY}#2`);
    expect(blockTitle(swapped, swapped.timeBlocks[0])).toBe("Zavolat bance");
    expect(toggleBlockDone(swapped, blockId, NOON).daySheets[0].priorities[2].done).toBe(true);
  });

  it("prohození na prázdné místo je přesun a nesmysly stavem nehnou", () => {
    const s = setPriority(EMPTY_STATE, DAY, 0, "Zavolat bance");

    expect(sheetOf(swapPriorities(s, DAY, 0, 1), DAY).priorities.map((p) => p.text)).toEqual([
      "",
      "Zavolat bance",
      "",
    ]);
    expect(swapPriorities(s, DAY, 1, 1)).toBe(s);
    expect(swapPriorities(s, DAY, 0, 9)).toBe(s);
    // Prázdný list nemá co prohazovat.
    expect(swapPriorities(EMPTY_STATE, DAY, 0, 1)).toBe(EMPTY_STATE);
  });

  it("druhé puštění do stejného políčka se pozná, ať nevzniknou dva stejné bloky", () => {
    const { state } = linked();
    const ref = priorityRef(DAY, 0);

    expect(hasPriorityBlockAt(state.timeBlocks, ref, 9 * 60, DAY)).toBe(true);
    expect(hasPriorityBlockAt(state.timeBlocks, ref, 9 * 60 + 30, DAY)).toBe(false);
    // Políčko je den a půlhodina - tatáž minuta jinde není též políčko.
    expect(hasPriorityBlockAt(state.timeBlocks, ref, 9 * 60, NEXT)).toBe(false);
    expect(hasPriorityBlockAt(state.timeBlocks, priorityRef(DAY, 1), 9 * 60, DAY)).toBe(false);
  });

  it("odkaz se dá navázat i sundat", () => {
    const { state, blockId } = linked();

    const loose = linkBlockToPriority(state, blockId, null);
    expect(loose.timeBlocks[0].priorityId).toBe(null);
    expect(toggleBlockDone(loose, blockId, NOON).daySheets[0].priorities[0].done).toBe(false);

    const again = linkBlockToPriority(loose, blockId, priorityRef(DAY, 0));
    expect(again.timeBlocks[0].priorityId).toBe(`${DAY}#0`);
  });
});

describe("list dne", () => {
  const texts = (s: MicroWinsState, date: string) =>
    sheetOf(s, date).priorities.map((p) => p.text);

  it("den bez listu se tváří prázdně a má tři priority", () => {
    const sheet = sheetOf(EMPTY_STATE, DAY);

    expect(sheet.priorities).toEqual([
      { text: "", done: false },
      { text: "", done: false },
      { text: "", done: false },
    ]);
    expect(isSheetEmpty(sheet)).toBe(true);
  });

  it("priority i brain dump se drží u svého dne", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, DAY, 1, "Zavolat bance");
    s = setBrainDump(s, DAY, "nápady");
    s = setPriority(s, NEXT, 0, "zítřek");

    expect(texts(s, DAY)).toEqual(["", "Zavolat bance", ""]);
    expect(sheetOf(s, DAY).brainDump).toBe("nápady");
    expect(texts(s, NEXT)[0]).toBe("zítřek");
    expect(s.daySheets).toHaveLength(2);
  });

  it("priorita se odškrtává, prázdný řádek ne", () => {
    const s = setPriority(EMPTY_STATE, DAY, 0, "Zavolat bance");

    const done = togglePriority(s, DAY, 0);
    expect(sheetOf(done, DAY).priorities[0]).toEqual({ text: "Zavolat bance", done: true });
    expect(sheetOf(togglePriority(done, DAY, 0), DAY).priorities[0].done).toBe(false);
    // Prázdný řádek nemá co odškrtávat - stav se nehne.
    expect(togglePriority(s, DAY, 2)).toBe(s);
  });

  it("vygumovaná priorita nezůstane odškrtnutá", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, DAY, 0, "Zavolat bance");
    s = togglePriority(s, DAY, 0);
    s = setPriority(s, DAY, 0, "");
    s = setPriority(s, DAY, 0, "Něco jiného");

    expect(sheetOf(s, DAY).priorities[0]).toEqual({ text: "Něco jiného", done: false });
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
      {
        date: DAY,
        priorities: [{ text: "a", done: true }, { text: "b" }, "c", { text: "d" }],
        brainDump: 5,
      },
      isValidISODate,
    );

    expect(sheet?.priorities).toEqual([
      { text: "a", done: true },
      { text: "b", done: false },
      // Priorita bývala holý text; ze starého zápisu je neodškrtnutá věc.
      { text: "c", done: false },
    ]);
    expect(sheet?.brainDump).toBe("");
    // Nesmyslné datum ani prázdný list se nenačítají.
    expect(normalizeSheet({ date: "kdysi", priorities: ["a"] }, isValidISODate)).toBe(null);
    expect(normalizeSheet({ date: DAY, priorities: [] }, isValidISODate)).toBe(null);
  });

  it("přenos na jiný den se z uložených dat dočte, nesmysl se zahodí", () => {
    const sheet = normalizeSheet(
      {
        date: DAY,
        priorities: [
          { text: "a", done: false, carriedTo: NEXT },
          { text: "b", carriedTo: "kdysi" },
          "c",
        ],
      },
      isValidISODate,
    );

    expect(sheet?.priorities[0].carriedTo).toBe(NEXT);
    expect(sheet?.priorities[1].carriedTo).toBeUndefined();
    expect(sheet?.priorities[2].carriedTo).toBeUndefined();
  });
});

/* Řádek s časem dopředu je dohoda mezi člověkem a mřížkou: napíšu kdy, appka
   to tam položí. Řádek pak v dumpu nezůstává - věc by ležela dvakrát. */
describe("čas na začátku řádku brain dumpu", () => {
  it("čas dopředu se stane blokem a z dumpu vypadne", () => {
    const { rest, scheduled } = splitDumpSchedule("14:30 běh\nnápady\n 9:15 káva");

    expect(scheduled).toEqual([
      { start: 14 * 60 + 30, title: "běh" },
      { start: 9 * 60 + 15, title: "káva" },
    ]);
    expect(rest).toBe("nápady");
  });

  it("čas za dvojtečkou na konci: úkol1:14:30 → úkol1 ve 14:30", () => {
    expect(parseDumpTime("úkol1:14:30")).toEqual({ start: 14 * 60 + 30, title: "úkol1" });
    expect(parseDumpTime("  zavolat mámě : 9:05 ")).toEqual({ start: 9 * 60 + 5, title: "zavolat mámě" });
    // Dvojtečka uvnitř textu zůstává textu.
    expect(parseDumpTime("Poznámka: zavolat:14:30")).toEqual({
      start: 14 * 60 + 30,
      title: "Poznámka: zavolat",
    });
    const { rest, scheduled } = splitDumpSchedule("úkol1:14:30\nnápady\n14:00 oběd");
    expect(scheduled).toEqual([
      { start: 14 * 60 + 30, title: "úkol1" },
      { start: 14 * 60, title: "oběd" },
    ]);
    expect(rest).toBe("nápady");
  });

  it("nesmyslný čas na konci i dvojtečka bez času zůstávají textem", () => {
    expect(parseDumpTime("vlak:25:00")).toBe(null);
    expect(parseDumpTime(":14:30")).toBe(null);
    expect(parseDumpTime("Poznámka: zavolat")).toBe(null);
    expect(parseDumpTime("vlak 14:30")).toBe(null);
  });

  it("nesmyslný čas i čas bez textu zůstávají obyčejným zápisem", () => {
    expect(splitDumpSchedule("25:00 vlak\n14:30\n14:3 káva\nvlak 14:30").scheduled).toEqual([]);
    expect(parseDumpTime("24:00 x")).toBe(null);
    expect(parseDumpTime("14:30")).toBe(null);
    expect(parseDumpTime("   ")).toBe(null);
  });
});

describe("nestihl jsem", () => {
  const EARLIER = "2026-09-25";
  const YESTERDAY = "2026-09-26";
  const TODAY = "2026-09-27";

  it("nedokončené hlavní věci z dřívějších dnů se nabídnou od nejstarší", () => {
    let s: MicroWinsState = EMPTY_STATE;
    s = setPriority(s, YESTERDAY, 0, "Běh");
    s = setPriority(s, EARLIER, 1, "GW");
    s = setPriority(s, EARLIER, 2, "Uklidit");
    s = togglePriority(s, EARLIER, 2);
    s = setPriority(s, TODAY, 0, "dnešní");

    expect(unfinishedCarryovers(s, TODAY)).toEqual([
      { date: EARLIER, index: 1, text: "GW" },
      { date: YESTERDAY, index: 0, text: "Běh" },
    ]);
  });

  it("přenos věc ze seznamu sundá a cesta zpátky ji vrátí", () => {
    const s = setPriority(EMPTY_STATE, YESTERDAY, 1, "Běh");

    const carried = markPriorityCarried(s, YESTERDAY, 1, TODAY);
    expect(unfinishedCarryovers(carried, TODAY)).toEqual([]);
    // Přenést ještě jednou na týž den nemá co změnit.
    expect(markPriorityCarried(carried, YESTERDAY, 1, TODAY)).toBe(carried);
    expect(markPriorityCarried(s, YESTERDAY, 2, TODAY)).toBe(s);

    const back = markPriorityCarried(carried, YESTERDAY, 1, null);
    expect(unfinishedCarryovers(back, TODAY)).toEqual([
      { date: YESTERDAY, index: 1, text: "Běh" },
    ]);
  });

  it("přepsaný text přenos udrží, vygumovaný řádek ho s sebou vezme", () => {
    const carried = markPriorityCarried(
      setPriority(EMPTY_STATE, YESTERDAY, 0, "Běh"),
      YESTERDAY,
      0,
      TODAY,
    );

    expect(
      sheetOf(setPriority(carried, YESTERDAY, 0, "Běh v parku"), YESTERDAY).priorities[0]
        .carriedTo,
    ).toBe(TODAY);
    expect(setPriority(carried, YESTERDAY, 0, "").daySheets).toHaveLength(0);
  });

  /* Přenos je dohoda na ten den, ne amnestie: den projde a věc hotová
     není - zase se ozve. */
  it("přenesená do mřížky se ozve znovu, když den projde a blok zůstal neodškrtnutý", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, YESTERDAY, 1, "Běh");
    s = markPriorityCarried(s, YESTERDAY, 1, TODAY);
    s = addBlock(s, {
      date: TODAY,
      start: 9 * 60,
      duration: 30,
      title: "Běh",
      priorityId: priorityRef(YESTERDAY, 1),
    }).state;

    // V den přenosu se skrývá - bloku zbývá ještě čas.
    expect(unfinishedCarryovers(s, TODAY)).toEqual([]);
    // Den prošel, blok neodškrtnutý - věc se ozve znovu.
    expect(unfinishedCarryovers(s, NEXT)).toEqual([{ date: YESTERDAY, index: 1, text: "Běh" }]);
  });

  it("odškrtnutí přeneseného bloku uzavře věc i na původním dni", () => {
    const NOON = new Date("2026-09-27T12:00:00");
    let s: MicroWinsState = setPriority(EMPTY_STATE, YESTERDAY, 1, "Běh");
    s = markPriorityCarried(s, YESTERDAY, 1, TODAY);
    const linked = addBlock(s, {
      date: TODAY,
      start: 9 * 60,
      duration: 30,
      title: "Běh",
      priorityId: priorityRef(YESTERDAY, 1),
    });

    const done = toggleBlockDone(linked.state, linked.block.id, NOON);
    expect(sheetOf(done, YESTERDAY).priorities[1].done).toBe(true);
    expect(unfinishedCarryovers(done, NEXT)).toEqual([]);
  });

  it("přenesená do trojky se neozve znovu - štafetu drží kopie", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, YESTERDAY, 1, "Běh");
    s = markPriorityCarried(s, YESTERDAY, 1, TODAY);
    // Přenos do trojky cílového dne zapíše kopii jako jeho prioritu.
    s = setPriority(s, TODAY, 0, "Běh");

    // Kopie se ozve (den prošel, neodškrtnutá); originál zůstává schovaný.
    expect(unfinishedCarryovers(s, NEXT)).toEqual([{ date: TODAY, index: 0, text: "Běh" }]);
  });

  it("smazání posledního bloku, který držel přenos, věc zase pustí do seznamu", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, YESTERDAY, 1, "Běh");
    s = markPriorityCarried(s, YESTERDAY, 1, TODAY);
    const linked = addBlock(s, {
      date: TODAY,
      start: 9 * 60,
      duration: 30,
      title: "Běh",
      priorityId: priorityRef(YESTERDAY, 1),
    });

    const freed = releaseCarriedBlock(linked.state, linked.block);
    expect(unfinishedCarryovers(freed, TODAY)).toEqual([
      { date: YESTERDAY, index: 1, text: "Běh" },
    ]);
  });

  /* Neodškrtnutý zápis z mřížky minulého dne je taky slib - přestože není
     hlavní věcí dne. Napojené zápisy se nenabízejí, ty dohlédne jejich zdroj. */
  it("volné neodškrtnuté zápisy z mřížky minulých dnů se nabídnou taky", () => {
    const NOON = new Date("2026-09-27T12:00:00");
    let s: MicroWinsState = addBlock(EMPTY_STATE, {
      date: YESTERDAY,
      start: 9 * 60,
      duration: 30,
      title: "Běh",
    }).state;
    const done = addBlock(s, { date: YESTERDAY, start: 10 * 60, duration: 30, title: "Uklizeno" });
    s = toggleBlockDone(done.state, done.block.id, NOON);
    s = addBlock(s, { date: YESTERDAY, start: 11 * 60, duration: 30, title: "Z ToDo", todoId: "td" })
      .state;
    s = addBlock(s, { date: TODAY, start: 9 * 60, duration: 30, title: "Dnešní" }).state;

    const items = unfinishedCarryovers(s, TODAY);
    expect(items).toEqual([
      { date: YESTERDAY, index: -1, text: "Běh", block: s.timeBlocks[0] },
    ]);

    // Přesun na dnešek věc ze seznamu sundá - blok už patří dnešku.
    expect(unfinishedCarryovers(moveBlockToDay(s, s.timeBlocks[0].id, TODAY), TODAY)).toEqual([]);
  });
});

describe("výběr času a délka tahem", () => {
  it("půlhodiny mřížky jdou po sobě i přes půlnoc", () => {
    const slots = timeboxSlots(timeboxRows(DAY, 23, 0));
    expect(slots).toEqual([
      { date: DAY, start: 23 * 60 },
      { date: DAY, start: 23 * 60 + 30 },
      { date: NEXT, start: 0 },
      { date: NEXT, start: 30 },
    ]);
  });

  it("výběr času vynechá uplynulé půlhodiny a obsazené jen označí", () => {
    const s = addBlock(EMPTY_STATE, { date: DAY, start: 10 * 60, duration: 60, title: "Porada" });
    const slots = timeboxSlots(timeboxRows(DAY, 9, 11));
    const choices = slotChoices(slots, s.state.timeBlocks, { today: DAY, nowMinutes: 9 * 60 + 40 });
    expect(choices.map((c) => [c.start / 60, c.busy])).toEqual([
      [9.5, false],
      [10, true],
      [10.5, true],
      [11, false],
      [11.5, false],
    ]);
    // Jiný den se nic nevynechává.
    expect(slotChoices(slots, [], { today: NEXT, nowMinutes: 23 * 60 })).toHaveLength(6);
    // Přeplánovávaný blok si nepřekáží sám sobě.
    const own = slotChoices(slots, s.state.timeBlocks, {
      today: DAY,
      nowMinutes: 0,
      exclude: s.block.id,
    });
    expect(own.every((c) => !c.busy)).toBe(true);
  });

});

describe("jedna věc na více místech listu", () => {
  const base = () => {
    let s = setBrainDump(EMPTY_STATE, DAY, "Běh\nNákup:18:00\nčíst");
    s = setPriority(s, DAY, 0, "Běh");
    s = addBlock(s, { date: DAY, start: 6 * 60, duration: 30, title: "běh" }).state;
    s = addBlock(s, { date: DAY, start: 18 * 60, duration: 30, title: "Nákup" }).state;
    return s;
  };

  it("pozná táž věc podle textu - bez velikosti písmen a času v dumpu", () => {
    const places = placesOf(base(), DAY, "  BĚH ");
    expect(places.dumpLines).toEqual([0]);
    expect(places.priority).toBe(0);
    expect(places.blocks.map((b) => b.start)).toEqual([360]);
    expect(placeCount(places)).toBe(3);
    expect(placesOf(base(), DAY, "Nákup").dumpLines).toEqual([1]);
    expect(placeCount(placesOf(base(), DAY, "číst"))).toBe(1);
  });

  it("smazat všude sundá věc z dumpu, trojky i papíru - a jde vrátit", () => {
    const before = base();
    const { state, removed } = deleteEverywhere(before, DAY, "Běh");
    expect(sheetOf(state, DAY).brainDump).toBe("Nákup:18:00\nčíst");
    expect(sheetOf(state, DAY).priorities[0].text).toBe("");
    expect(state.timeBlocks.map((b) => b.title)).toEqual(["Nákup"]);
    // Ostatní věci zůstaly, kde byly.
    expect(placeCount(placesOf(state, DAY, "Nákup"))).toBe(2);

    const back = restoreEverywhere(state, removed!);
    expect(sheetOf(back, DAY)).toEqual(sheetOf(before, DAY));
    expect(back.timeBlocks.map((b) => b.title).sort()).toEqual(["Nákup", "běh"]);
  });

  it("smazat všude bere i blok hlavní věci, který si text drží z trojky", () => {
    let s = setPriority(EMPTY_STATE, DAY, 1, "Projekt");
    s = addBlock(s, { date: DAY, start: 600, duration: 30, title: "Projekt", priorityId: priorityRef(DAY, 1) }).state;
    const { state } = deleteEverywhere(s, DAY, "projekt");
    expect(state.timeBlocks).toEqual([]);
    expect(sheetOf(state, DAY).priorities[1].text).toBe("");
  });

  it("přejmenování přepíše věc všude a čas v dumpu nechá", () => {
    const s = renameEverywhere(base(), DAY, "Nákup", "Velký nákup");
    expect(sheetOf(s, DAY).brainDump).toBe("Běh\nVelký nákup:18:00\nčíst");
    expect(s.timeBlocks.find((b) => b.start === 18 * 60)?.title).toBe("Velký nákup");
    const r = renameEverywhere(base(), DAY, "Běh", "Ranní běh");
    expect(sheetOf(r, DAY).priorities[0].text).toBe("Ranní běh");
    expect(sheetOf(r, DAY).brainDump.split("\n")[0]).toBe("Ranní běh");
  });

  it("přejmenování na text, který už jinde je, nic neslévá", () => {
    const s = base();
    expect(renameEverywhere(s, DAY, "číst", "Běh")).toBe(s);
  });
});
