import { addDays } from "./date";
import { blockEnd } from "./timeblocks";
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

// --- list dne ---------------------------------------------------------------

export function emptySheet(date: ISODate): DaySheet {
  return { date, priorities: Array.from({ length: PRIORITY_COUNT }, () => ""), brainDump: "" };
}

export function sheetOf(state: MicroWinsState, date: ISODate): DaySheet {
  return state.daySheets.find((s) => s.date === date) ?? emptySheet(date);
}

export function isSheetEmpty(sheet: DaySheet): boolean {
  return sheet.brainDump.trim() === "" && sheet.priorities.every((p) => p.trim() === "");
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
    current.priorities.every((p, i) => p === sheet.priorities[i]);
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
  if (!Number.isInteger(index) || index < 0 || index >= PRIORITY_COUNT) return state;
  const sheet = sheetOf(state, date);
  const priorities = [...sheet.priorities];
  priorities[index] = text.slice(0, PRIORITY_MAX);
  return putSheet(state, { ...sheet, priorities });
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
 */
export function normalizeSheet(raw: unknown, isDate: (value: string) => boolean): DaySheet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.date !== "string" || !isDate(record.date)) return null;

  const incoming = Array.isArray(record.priorities) ? record.priorities : [];
  const priorities = Array.from({ length: PRIORITY_COUNT }, (_, i) =>
    typeof incoming[i] === "string" ? (incoming[i] as string).slice(0, PRIORITY_MAX) : "",
  );
  const sheet: DaySheet = {
    date: record.date,
    priorities,
    brainDump:
      typeof record.brainDump === "string" ? record.brainDump.slice(0, BRAIN_DUMP_MAX) : "",
  };
  return isSheetEmpty(sheet) ? null : sheet;
}
