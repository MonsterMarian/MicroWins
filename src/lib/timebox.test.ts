import { describe, expect, it } from "vitest";
import { isValidISODate } from "./date";
import { addBlock, blockTitle, linkBlockToPriority } from "./timeblocks";
import { addTodo } from "./todos";
import {
  hasPriorityBlockAt,
  isSheetEmpty,
  markCarried,
  markPriorityCarried,
  normalizeSheet,
  parseDumpTime,
  priorityRef,
  replacePriority,
  restorePriority,
  setBrainDump,
  setPriority,
  sheetOf,
  splitDumpSchedule,
  swapPriorities,
  toggleBlockDone,
  toggleCarryoverDone,
  togglePriority,
  slotContent,
  slotStart,
  timeboxRowCount,
  timeboxRows,
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

  /* Hlavní věc se dá posadit do mřížky víckrát; odškrtnutí jednoho zápisu
     musí odškrtnout i ten druhý, jinak visí nehotový zápis hotové věci. */
  it("odškrtnutí jednoho zápisu odškrtne i další zápisy té věci", () => {
    const { state, blockId } = linked();
    const twice = addBlock(
      state,
      { date: DAY, start: 14 * 60, title: "Zavolat bance", priorityId: priorityRef(DAY, 0) },
      NOON,
    ).state;

    const done = toggleBlockDone(twice, blockId, NOON);
    expect(sheetOf(done, DAY).priorities[0].done).toBe(true);
    expect(done.timeBlocks.every((b) => b.doneAt !== null)).toBe(true);

    const back = toggleBlockDone(done, blockId, NOON);
    expect(back.timeBlocks.every((b) => b.doneAt === null)).toBe(true);
  });

  it("jiná věc na místě hlavní věci nezdědí odškrtnutí ani její zápisy", () => {
    const { state } = linked();
    const done = togglePriority(state, DAY, 0, NOON);

    const replaced = replacePriority(done, DAY, 0, "Nákup");
    expect(sheetOf(replaced, DAY).priorities[0]).toEqual({ text: "Nákup", done: false });
    // Zápis staré věci se odpojí a nechá si její text - neukazuje cizí.
    expect(replaced.timeBlocks[0].priorityId).toBe(null);
    expect(blockTitle(replaced, replaced.timeBlocks[0])).toBe("Zavolat bance");

    const back = restorePriority(
      replaced,
      DAY,
      0,
      sheetOf(done, DAY).priorities[0],
      [replaced.timeBlocks[0].id],
    );
    expect(sheetOf(back, DAY).priorities[0]).toEqual({ text: "Zavolat bance", done: true });
    expect(back.timeBlocks[0].priorityId).toBe(priorityRef(DAY, 0));
  });

  /* Vygumovaná hlavní věc s navázanými bloky: kdyby odkaz zůstal, zápis by
     se na místo napsané později přilepil a ukazoval by cizí text. */
  it("vygumování přes replacePriority odpojí zápisy od uvolněného místa", () => {
    const { state } = linked();
    const erased = replacePriority(state, DAY, 0, "");
    const later = setPriority(erased, DAY, 0, "Úplně jiná věc");

    expect(blockTitle(later, later.timeBlocks[0])).toBe("Zavolat bance");
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

    expect(hasPriorityBlockAt(state.timeBlocks, ref, DAY, 9 * 60)).toBe(true);
    expect(hasPriorityBlockAt(state.timeBlocks, ref, DAY, 9 * 60 + 30)).toBe(false);
    expect(hasPriorityBlockAt(state.timeBlocks, priorityRef(DAY, 1), DAY, 9 * 60)).toBe(false);
    // Stejný čas jiného dne je jiné políčko (mřížka přes půlnoc).
    expect(hasPriorityBlockAt(state.timeBlocks, ref, NEXT, 9 * 60)).toBe(false);
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
      { kind: "priority", date: EARLIER, index: 1, text: "GW" },
      { kind: "priority", date: YESTERDAY, index: 0, text: "Běh" },
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
      { kind: "priority", date: YESTERDAY, index: 1, text: "Běh" },
    ]);
  });

  /* Zápis napsaný do mřížky včera, který se neodškrtl, je taky „nestihl
     jsem" - dřív se sem braly jen hlavní věci a včerejší zápis prostě zmizel. */
  it("nestihnuté zápisy z mřížky se nabídnou taky, navázané ne", () => {
    let s: MicroWinsState = setPriority(EMPTY_STATE, YESTERDAY, 0, "Běh");
    const plain = addBlock(s, { date: YESTERDAY, start: 600, title: "Nafotit Lego" });
    s = plain.state;
    const early = addBlock(s, { date: YESTERDAY, start: 480, title: "Mail účetní" });
    s = early.state;
    // Hotový zápis, zápis z ToDo a zápis z hlavní věci se ozvou jinde.
    const done = addBlock(s, { date: YESTERDAY, start: 700, title: "hotový" });
    s = toggleBlockDone(done.state, done.block.id);
    const todo = addTodo(s, "Služby na net");
    s = addBlock(todo.state, { date: YESTERDAY, start: 720, title: "Služby", todoId: todo.todo!.id }).state;
    s = addBlock(s, { date: YESTERDAY, start: 750, title: "Běh", priorityId: priorityRef(YESTERDAY, 0) }).state;
    // Dnešní zápis ještě nestihnutý být nemůže.
    s = addBlock(s, { date: TODAY, start: 480, title: "dnes" }).state;

    expect(unfinishedCarryovers(s, TODAY)).toEqual([
      { kind: "priority", date: YESTERDAY, index: 0, text: "Běh" },
      { kind: "block", date: YESTERDAY, id: early.block.id, start: 480, text: "Mail účetní" },
      { kind: "block", date: YESTERDAY, id: plain.block.id, start: 600, text: "Nafotit Lego" },
    ]);
  });

  it("zápis se dá přenést, odškrtnout i vrátit stejně jako hlavní věc", () => {
    const { state, block } = addBlock(EMPTY_STATE, { date: YESTERDAY, start: 600, title: "Lego" });
    const [item] = unfinishedCarryovers(state, TODAY);

    const carried = markCarried(state, item, TODAY);
    expect(unfinishedCarryovers(carried, TODAY)).toEqual([]);
    expect(unfinishedCarryovers(markCarried(carried, item, null), TODAY)).toHaveLength(1);

    const finished = toggleCarryoverDone(state, item);
    expect(finished.timeBlocks[0].doneAt).not.toBeNull();
    expect(unfinishedCarryovers(finished, TODAY)).toEqual([]);
    // Odškrtnutí platí na původním dni - nic dalšího nevzniká.
    expect(finished.timeBlocks).toHaveLength(1);
    expect(finished.timeBlocks[0].id).toBe(block.id);
  });

  it("odškrtnutá nestihnutá hlavní věc zůstane na svém dni, jen hotová", () => {
    const s = setPriority(EMPTY_STATE, YESTERDAY, 0, "Běh");
    const [item] = unfinishedCarryovers(s, TODAY);

    const finished = toggleCarryoverDone(s, item);
    expect(sheetOf(finished, YESTERDAY).priorities[0].done).toBe(true);
    expect(finished.timeBlocks).toHaveLength(0);
  });

  it("hranice je den, před kterým se hledá - pohled do minulosti vidí jen starší", () => {
    let s = setPriority(EMPTY_STATE, EARLIER, 0, "starší");
    s = setPriority(s, YESTERDAY, 0, "včerejší");

    expect(unfinishedCarryovers(s, YESTERDAY).map((i) => i.text)).toEqual(["starší"]);
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
});
