import { addDays } from "./date";
import { blockEnd, toggleBlockDone as toggleBlock } from "./timeblocks";
import type { DaySheet, ISODate, MicroWinsState, TimeBlock } from "./types";

/**
 * Time box - list dne rozkrájený po půlhodinách.
 *
 * Mřížka **nemá vlastní data**: políčko je obyčejný blok plánu
 * (`lib/timeblocks.ts`). Co se napíše do time boxu, stojí i v Plánu dne a
 * odškrtává se jen jednou. Dva seznamy o tomtéž dni, které o sobě nevědí, jsou
 * to nejhorší, co plánovač může mít - v jednom je schůzka, ve druhém ne a
 * člověk neví, čemu věřit.
 *
 * Ke dni ale patří ještě tři priority a brain dump. Ty v blocích bydlet
 * nemůžou (nemají čas ani délku), takže mají vlastní `DaySheet`.
 *
 * Čisté funkce, žádný React ani localStorage - viz `timebox.test.ts`.
 */

/** Půl hodiny na políčko: sloupce `:00` a `:30`, jak je na papírovém listu. */
export const SHEET_SLOT = 30;

export const PRIORITY_COUNT = 3;
export const PRIORITY_MAX = 120;
export const BRAIN_DUMP_MAX = 4000;

/** Výchozí rozsah mřížky - 5:00 až 23:30, přesně jako na předloze. */
export const DEFAULT_TIMEBOX_START = 5;
export const DEFAULT_TIMEBOX_END = 23;

export function clampHour(hour: unknown): number {
  if (typeof hour !== "number" || !Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.round(hour)));
}

/**
 * Řádek mřížky: hodina a den, do kterého patří.
 *
 * Den nese každý řádek zvlášť kvůli rozsahu přes půlnoc (7-1 pro noční ptáky):
 * hodiny po půlnoci už patří **dalšímu dni**, protože blok se ukládá ke dni,
 * ve kterém se odehrává. Bez toho by se ranní hodiny psaly do včerejška.
 */
export interface TimeboxRow {
  hour: number;
  date: ISODate;
}

/** Kolik hodinových řádků rozsah zabere. Konec před začátkem přetéká přes půlnoc. */
export function timeboxRowCount(startHour: number, endHour: number): number {
  const start = clampHour(startHour);
  const end = clampHour(endHour);
  return end >= start ? end - start + 1 : 24 - start + end + 1;
}

export function timeboxRows(
  date: ISODate,
  startHour: number = DEFAULT_TIMEBOX_START,
  endHour: number = DEFAULT_TIMEBOX_END,
): TimeboxRow[] {
  const start = clampHour(startHour);
  const count = timeboxRowCount(startHour, endHour);
  return Array.from({ length: count }, (_, i) => ({
    hour: (start + i) % 24,
    date: start + i < 24 ? date : addDays(date, 1),
  }));
}

/** Minuty od půlnoci pro políčko - `half` je sloupec `:30`. */
export function slotStart(hour: number, half: boolean): number {
  return clampHour(hour) * 60 + (half ? SHEET_SLOT : 0);
}

export interface SlotContent {
  /** Bloky, které v políčku začínají - ty se v něm píšou. */
  blocks: TimeBlock[];
  /**
   * Blok, který do políčka zasahuje z dřívějška; políčko je jeho pokračování.
   * Delší blok z Plánu tak v mřížce nezmizí ani se nezopakuje - jednou stojí
   * napsaný a dál už jen pokračuje čarou.
   */
  running: TimeBlock | null;
}

/**
 * Co patří do políčka začínajícího v `start`.
 *
 * Blok padá do políčka, ve kterém **začíná** - i když začíná v 9:15, protože
 * plán jede po čtvrthodinách a time box po půlhodinách. Přesný čas si pak
 * políčko ukáže u popisku, aby se ta čtvrthodina neztratila.
 */
export function slotContent(blocks: TimeBlock[], start: number): SlotContent {
  const end = start + SHEET_SLOT;
  const own = blocks
    .filter((b) => b.start >= start && b.start < end)
    .sort((a, b) => a.start - b.start || a.createdAt.localeCompare(b.createdAt));
  if (own.length > 0) return { blocks: own, running: null };
  return {
    blocks: own,
    running: blocks.find((b) => b.start < start && blockEnd(b) > start) ?? null,
  };
}

// --- propojení priority s blokem --------------------------------------------

/**
 * Odkaz na prioritu. Priorita nemá vlastní id - drží ji den a pořadí v trojce -
 * takže se skládá z obojího: `2026-09-28#0`.
 */
export function priorityRef(date: ISODate, index: number): string {
  return `${date}#${index}`;
}

export function parsePriorityRef(ref: string | null): { date: ISODate; index: number } | null {
  if (!ref) return null;
  const [date, raw] = ref.split("#");
  const index = Number(raw);
  if (!date || !isPriorityIndex(index)) return null;
  return { date, index };
}

/**
 * Má už ta hlavní věc dne blok v tomhle políčku?
 *
 * Přetažení do mřížky zakládá nový blok, takže druhé puštění na stejné místo
 * by vyrobilo dva stejné zápisy přes sebe - a odškrtnout by se musely oba.
 */
export function hasPriorityBlockAt(
  blocks: TimeBlock[],
  ref: string,
  start: number,
): boolean {
  return blocks.some(
    (b) => b.priorityId === ref && b.start >= start && b.start < start + SHEET_SLOT,
  );
}

/** Text priority, na kterou odkaz ukazuje; prázdný, když už tam nic není. */
export function priorityText(state: MicroWinsState, ref: string | null): string {
  const parsed = parsePriorityRef(ref);
  if (!parsed) return "";
  return sheetOf(state, parsed.date).priorities[parsed.index]?.text ?? "";
}

/** Je ta priorita odškrtnutá? Podklad pro odškrtnutí bloku ze druhé strany. */
export function isPriorityDone(state: MicroWinsState, ref: string | null): boolean {
  const parsed = parsePriorityRef(ref);
  if (!parsed) return false;
  return sheetOf(state, parsed.date).priorities[parsed.index]?.done === true;
}

/** Nastaví odškrtnutí priority napevno - používá se při odškrtnutí bloku. */
export function setPriorityDone(
  state: MicroWinsState,
  ref: string | null,
  done: boolean,
): MicroWinsState {
  const parsed = parsePriorityRef(ref);
  if (!parsed) return state;
  const sheet = sheetOf(state, parsed.date);
  const current = sheet.priorities[parsed.index];
  if (!current || current.text.trim() === "" || current.done === done) return state;
  const priorities = [...sheet.priorities];
  priorities[parsed.index] = { ...current, done };
  return putSheet(state, { ...sheet, priorities });
}

// --- list dne ---------------------------------------------------------------

export function emptySheet(date: ISODate): DaySheet {
  return {
    date,
    priorities: Array.from({ length: PRIORITY_COUNT }, () => ({ text: "", done: false })),
    brainDump: "",
  };
}

export function sheetOf(state: MicroWinsState, date: ISODate): DaySheet {
  return state.daySheets.find((s) => s.date === date) ?? emptySheet(date);
}

export function isSheetEmpty(sheet: DaySheet): boolean {
  return sheet.brainDump.trim() === "" && sheet.priorities.every((p) => p.text.trim() === "");
}

/**
 * Uloží list dne. Vyprázdněný list se z dat vyhodí - jinak by po roce ležela
 * v úložišti stovka prázdných dnů, do kterých se jen omylem ťuklo.
 */
function putSheet(state: MicroWinsState, sheet: DaySheet): MicroWinsState {
  const current = state.daySheets.find((s) => s.date === sheet.date);
  const same =
    current !== undefined &&
    current.brainDump === sheet.brainDump &&
    current.priorities.length === sheet.priorities.length &&
    current.priorities.every(
      (p, i) => p.text === sheet.priorities[i].text && p.done === sheet.priorities[i].done,
    );
  if (same || (current === undefined && isSheetEmpty(sheet))) return state;

  const rest = state.daySheets.filter((s) => s.date !== sheet.date);
  return {
    ...state,
    daySheets: isSheetEmpty(sheet)
      ? rest
      : [...rest, sheet].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function setPriority(
  state: MicroWinsState,
  date: ISODate,
  index: number,
  text: string,
): MicroWinsState {
  if (!isPriorityIndex(index)) return state;
  const sheet = sheetOf(state, date);
  const priorities = [...sheet.priorities];
  const value = text.slice(0, PRIORITY_MAX);
  // Vygumovaná priorita nezůstane odškrtnutá - na prázdném řádku nemá co dělat.
  priorities[index] = { text: value, done: value.trim() === "" ? false : priorities[index].done };
  return putSheet(state, { ...sheet, priorities });
}

/**
 * Odškrtnutí hlavní věci dne. Prázdný řádek se odškrtnout nedá.
 *
 * Odškrtne i bloky, které z té priority vznikly - je to jedna věc ze dvou
 * stran, stejně jako termín v ToDo a blok v plánu. Odškrtávat ji dvakrát by
 * byla práce navíc, kterou nikdo nechce.
 */
export function togglePriority(
  state: MicroWinsState,
  date: ISODate,
  index: number,
  now: Date = new Date(),
): MicroWinsState {
  if (!isPriorityIndex(index)) return state;
  const sheet = sheetOf(state, date);
  if (sheet.priorities[index].text.trim() === "") return state;

  const done = !sheet.priorities[index].done;
  const priorities = [...sheet.priorities];
  priorities[index] = { ...priorities[index], done };
  const next = putSheet(state, { ...sheet, priorities });

  const ref = priorityRef(date, index);
  const stamp = now.toISOString();
  return {
    ...next,
    timeBlocks: next.timeBlocks.map((b) =>
      b.priorityId === ref && (b.doneAt !== null) !== done
        ? { ...b, doneAt: done ? stamp : null }
        : b,
    ),
  };
}

/**
 * Prohodí dvě hlavní věci dne - přetažení jedné na druhou.
 *
 * Musí prohodit **i odkazy bloků**: odkaz na prioritu je `den#pořadí`, takže
 * po prohození textů by blok navázaný na první věc ukazoval na cizí text
 * a odškrtával by něco jiného, než na co byl napsaný.
 */
export function swapPriorities(
  state: MicroWinsState,
  date: ISODate,
  a: number,
  b: number,
): MicroWinsState {
  if (a === b || !isPriorityIndex(a) || !isPriorityIndex(b)) return state;
  const sheet = sheetOf(state, date);
  const priorities = [...sheet.priorities];
  [priorities[a], priorities[b]] = [priorities[b], priorities[a]];
  const next = putSheet(state, { ...sheet, priorities });

  const refA = priorityRef(date, a);
  const refB = priorityRef(date, b);
  if (!next.timeBlocks.some((block) => block.priorityId === refA || block.priorityId === refB)) {
    return next;
  }
  return {
    ...next,
    timeBlocks: next.timeBlocks.map((block) =>
      block.priorityId === refA
        ? { ...block, priorityId: refB }
        : block.priorityId === refB
          ? { ...block, priorityId: refA }
          : block,
    ),
  };
}

function isPriorityIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < PRIORITY_COUNT;
}

/**
 * Odškrtnutí bloku i priority, ze které vznikl.
 *
 * Bydlí tady, a ne v `timeblocks.ts`: bloky o prioritách nevědí a vědět
 * nepotřebují - list time boxu je ta vrstva, která obě strany zná.
 */
export function toggleBlockDone(
  state: MicroWinsState,
  id: string,
  now: Date = new Date(),
): MicroWinsState {
  const block = state.timeBlocks.find((b) => b.id === id);
  if (!block) return state;
  const next = toggleBlock(state, id, now);
  const done = next.timeBlocks.find((b) => b.id === id)?.doneAt !== null;
  return setPriorityDone(next, block.priorityId, done);
}

export function setBrainDump(
  state: MicroWinsState,
  date: ISODate,
  text: string,
): MicroWinsState {
  return putSheet(state, { ...sheetOf(state, date), brainDump: text.slice(0, BRAIN_DUMP_MAX) });
}

/**
 * List z uložených dat. Počet priorit se srovná na tři - starší nebo cizí
 * záloha jich může mít jiný počet a mřížka na obrazovce počítá se třemi.
 *
 * Priorita byla zprvu holý text, teprve pak se k ní přidalo odškrtnutí; obojí
 * se proto načte a ze starého zápisu vznikne neodškrtnutá věc.
 */
export function normalizeSheet(raw: unknown, isDate: (value: string) => boolean): DaySheet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.date !== "string" || !isDate(record.date)) return null;

  const incoming = Array.isArray(record.priorities) ? record.priorities : [];
  const priorities = Array.from({ length: PRIORITY_COUNT }, (_, i) => {
    const item = incoming[i];
    if (typeof item === "string") return { text: item.slice(0, PRIORITY_MAX), done: false };
    if (typeof item === "object" && item !== null) {
      const p = item as Record<string, unknown>;
      const text = typeof p.text === "string" ? p.text.slice(0, PRIORITY_MAX) : "";
      return { text, done: text.trim() !== "" && p.done === true };
    }
    return { text: "", done: false };
  });
  const sheet: DaySheet = {
    date: record.date,
    priorities,
    brainDump:
      typeof record.brainDump === "string" ? record.brainDump.slice(0, BRAIN_DUMP_MAX) : "",
  };
  return isSheetEmpty(sheet) ? null : sheet;
}
