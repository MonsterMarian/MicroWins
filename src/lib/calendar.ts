import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { CapacitorCalendar, type CalendarEvent } from "@ebarooni/capacitor-calendar";
import { addDays, fromISODate } from "./date";
import { isNative } from "./native";
import { blockTitle, DAY_MINUTES } from "./timeblocks";
import type { ISODate, MicroWinsState, TimeBlock } from "./types";

/**
 * Napojení time boxu na kalendář v telefonu - a přes něj na Google Kalendář.
 *
 * Appka nemluví s Googlem přímo: telefon si Google kalendář synchronizuje sám
 * a appka čte a zapisuje do systémového kalendáře (Android CalendarContract).
 * Nepotřebuje tak OAuth, server ani tajný klíč a jede i offline. O odeslání
 * do Googlu si appka řekne sama (`CalendarSync`) - s vypnutou automatickou
 * synchronizací účtů by ho Android neudělal.
 *
 * Dva směry, oba nepovinné a nastavené **jen pro tohle zařízení** (id
 * kalendářů jsou v každém telefonu jiná, proto ne v `prefs`, které se
 * synchronizují):
 *
 * - **čtení**: události ze všech viditelných kalendářů se v mřížce ukážou jako
 *   „obsazeno". Nejsou to bloky, nic se z nich neukládá.
 * - **zápis**: bloky se zrcadlí do jednoho vybraného kalendáře. Zdroj pravdy
 *   je appka - událost upravená v Googlu se při dalším zápisu přepíše zpátky.
 *   Událost se s blokem páruje značkou `microwins:<id>` v popisu, takže appka
 *   nepotřebuje vlastní tabulku a přeinstalace nevyrobí duplikáty.
 *
 * Čisté funkce (`dayEvents`, `planCalendarSync`, …) jsou testované v
 * calendar.test.ts; zbytek je tenký most k pluginu, v prohlížeči nedělá nic.
 */

// --- nastavení zařízení ------------------------------------------------------

export interface CalendarSettings {
  /** Ukazovat události z kalendářů telefonu v mřížce. */
  read: boolean;
  /** Kalendář, do kterého se zrcadlí bloky; null = nezapisovat. */
  writeTo: string | null;
}

const SETTINGS_KEY = "microwins:calendar";
const DEFAULT_SETTINGS: CalendarSettings = { read: false, writeTo: null };

let cache: CalendarSettings | null = null;
const listeners = new Set<() => void>();

/** Snímek pro `useSyncExternalStore` - stálá identita, dokud se nic nezmění. */
export function getCalendarSettings(): CalendarSettings {
  if (cache) return cache;
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null");
    cache = {
      read: raw?.read === true,
      writeTo: typeof raw?.writeTo === "string" ? raw.writeTo : null,
    };
  } catch {
    cache = DEFAULT_SETTINGS;
  }
  return cache;
}

export function getDefaultCalendarSettings(): CalendarSettings {
  return DEFAULT_SETTINGS;
}

export function setCalendarSettings(patch: Partial<CalendarSettings>): void {
  cache = { ...getCalendarSettings(), ...patch };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(cache));
  } catch {
    // soukromý režim - volba vydrží aspoň do zavření appky
  }
  for (const fn of listeners) fn();
}

export function subscribeCalendarSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- čtení: události do mřížky ----------------------------------------------

/** Událost kalendáře přepočtená na jeden den mřížky. */
export interface DayEvent {
  id: string;
  title: string;
  /** Minuty od půlnoci; u události z předchozího dne 0. */
  start: number;
  /** Délka v rámci dne - přes půlnoc se usekne. */
  duration: number;
  allDay: boolean;
}

/** Začátek dne v lokálním čase jako epoch ms. */
export function dayStartMs(date: ISODate): number {
  const d = fromISODate(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Události, které zasahují do dne `date`, oříznuté na ten den.
 *
 * Celodenní události Android ukládá od půlnoci UTC, takže se jejich den čte
 * v UTC - v lokálním čase by na západ od Greenwiche spadly o den dřív.
 */
export function dayEvents(events: CalendarEvent[], date: ISODate): DayEvent[] {
  const from = dayStartMs(date);
  const to = dayStartMs(addDays(date, 1));
  const out: DayEvent[] = [];
  for (const e of events) {
    if (e.isAllDay) {
      const first = new Date(e.startDate).toISOString().slice(0, 10);
      const last = new Date(e.endDate - 1).toISOString().slice(0, 10);
      if (first <= date && date <= last) {
        out.push({ id: e.id, title: e.title, start: 0, duration: DAY_MINUTES, allDay: true });
      }
      continue;
    }
    if (e.endDate <= from || e.startDate >= to) continue;
    const begin = Math.max(e.startDate, from);
    const end = Math.min(e.endDate, to);
    const d = new Date(begin);
    out.push({
      id: e.id,
      title: e.title,
      start: d.getHours() * 60 + d.getMinutes(),
      duration: Math.max(1, Math.round((end - begin) / 60_000)),
      allDay: false,
    });
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

// --- zápis: bloky do kalendáře -----------------------------------------------

const MARKER = "microwins:";
const MARKER_RE = /(?:^|\s)microwins:([A-Za-z0-9_-]+)/;

/** Id bloku ze značky v popisu události; null = událost appce nepatří. */
export function markerOf(description: string | null): string | null {
  return description?.match(MARKER_RE)?.[1] ?? null;
}

export function describeBlock(blockId: string): string {
  return `Z MicroWins - upravuj v appce, změny tady se přepíšou.\n${MARKER}${blockId}`;
}

/** Jak má událost za blok vypadat. */
export interface DesiredEvent {
  blockId: string;
  title: string;
  startDate: number;
  endDate: number;
}

export function desiredEvent(state: MicroWinsState, block: TimeBlock): DesiredEvent {
  const d = fromISODate(block.date);
  // Minuty přes `setHours` - Date sám přepočte přechod na letní čas.
  d.setHours(0, block.start, 0, 0);
  const title = blockTitle(state, block) || "Blok";
  return {
    blockId: block.id,
    title: block.doneAt ? `✓ ${title}` : title,
    startDate: d.getTime(),
    endDate: d.getTime() + block.duration * 60_000,
  };
}

/**
 * Dny, které se zrcadlí: od včerejška dva týdny dopředu. Starší události
 * zůstanou v kalendáři jako historie.
 * shortcut: blok naplánovaný dál než 14 dní se zapíše, až se k němu okno přiblíží.
 */
export function syncWindow(today: ISODate): { from: ISODate; to: ISODate } {
  return { from: addDays(today, -1), to: addDays(today, 14) };
}

export interface CalendarPlan {
  create: DesiredEvent[];
  update: (DesiredEvent & { id: string })[];
  remove: string[];
}

/**
 * Co udělat, aby kalendář odpovídal blokům.
 *
 * `existing` jsou události cílového kalendáře v okně. Cizí události (bez
 * značky) se nechávají být. Blok bez události → založit, rozjetý text či čas
 * → upravit, událost bez bloku nebo druhá za tentýž blok → smazat.
 */
export function planCalendarSync(desired: DesiredEvent[], existing: CalendarEvent[]): CalendarPlan {
  const plan: CalendarPlan = { create: [], update: [], remove: [] };
  const byBlock = new Map<string, CalendarEvent[]>();
  for (const e of existing) {
    const blockId = markerOf(e.description);
    if (!blockId) continue;
    byBlock.set(blockId, [...(byBlock.get(blockId) ?? []), e]);
  }
  for (const want of desired) {
    const [event, ...extra] = byBlock.get(want.blockId) ?? [];
    byBlock.delete(want.blockId);
    plan.remove.push(...extra.map((e) => e.id));
    if (!event) plan.create.push(want);
    else if (
      event.title !== want.title ||
      event.startDate !== want.startDate ||
      event.endDate !== want.endDate
    ) {
      plan.update.push({ ...want, id: event.id });
    }
  }
  for (const orphans of byBlock.values()) plan.remove.push(...orphans.map((e) => e.id));
  return plan;
}

// --- most k pluginu ------------------------------------------------------------

/**
 * Vlastní plugin (android/…/CalendarSyncPlugin.java): ruční synchronizace s
 * Googlem - s vypnutou automatickou synchronizací účtů by jinak nic neodešlo
 * ani nepřišlo - a hlášení změn kalendáře v telefonu.
 */
interface CalendarSyncPlugin {
  requestSync(options: { upload: boolean }): Promise<void>;
  watch(): Promise<void>;
  addListener(event: "change", fn: () => void): Promise<PluginListenerHandle>;
}

const CalendarSync = registerPlugin<CalendarSyncPlugin>("CalendarSync");

/** Stáhne z Googlu novinky do viditelných kalendářů telefonu. */
export async function syncPhoneCalendars(): Promise<void> {
  if (!isNative() || !getCalendarSettings().read) return;
  try {
    await CalendarSync.requestSync({ upload: false });
  } catch {
    // bez přístupu nebo bez sítě - zkusí se při dalším návratu do appky
  }
}

/** Zavolá `fn` při každé změně kalendáře v telefonu (i po synchronizaci). */
export function onCalendarChange(fn: () => void): () => void {
  if (!isNative()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let stopped = false;
  void CalendarSync.watch()
    .then(() => CalendarSync.addListener("change", fn))
    .then((h) => {
      if (stopped) void h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    void handle?.remove();
  };
}

export interface PhoneCalendar {
  id: string;
  title: string;
  account: string;
  color: string | null;
  writable: boolean;
}

/** Zeptá se na přístup ke kalendáři. Odmítnutí = false, nic nespadne. */
export async function requestCalendarAccess(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { result } = await CapacitorCalendar.requestFullCalendarAccess();
    return result === "granted";
  } catch {
    return false;
  }
}

/** Viditelné kalendáře telefonu. */
export async function listPhoneCalendars(): Promise<PhoneCalendar[]> {
  if (!isNative()) return [];
  const { result } = await CapacitorCalendar.listCalendars();
  return result
    .filter((c) => c.visible !== false)
    .map((c) => ({
      id: c.id,
      title: c.title ?? "Kalendář",
      account: c.accountName ?? "",
      color: c.color,
      writable: c.allowsContentModifications === true,
    }));
}

async function eventsInRange(from: ISODate, to: ISODate): Promise<CalendarEvent[]> {
  const { result } = await CapacitorCalendar.listEventsInRange({
    from: dayStartMs(from),
    to: dayStartMs(addDays(to, 1)),
  });
  return result;
}

/**
 * Události k zobrazení v mřížce: všechny viditelné kalendáře kromě toho, kam
 * appka zapisuje - jinak by se vlastní bloky ukázaly dvakrát.
 */
export async function readEvents(from: ISODate, to: ISODate): Promise<CalendarEvent[]> {
  const { read, writeTo } = getCalendarSettings();
  if (!isNative() || !read) return [];
  try {
    const shown = new Set((await listPhoneCalendars()).map((c) => c.id));
    shown.delete(writeTo ?? "");
    return (await eventsInRange(from, to)).filter((e) => e.calendarId && shown.has(e.calendarId));
  } catch {
    // přístup odebraný v systému - mřížka prostě bude bez událostí
    return [];
  }
}

/** Zrcadlí bloky z okna `syncWindow` do vybraného kalendáře. */
export async function writeBlocks(state: MicroWinsState, today: ISODate): Promise<void> {
  const { writeTo } = getCalendarSettings();
  if (!isNative() || !writeTo) return;
  const { from, to } = syncWindow(today);
  const desired = state.timeBlocks
    .filter((b) => b.date >= from && b.date <= to)
    .map((b) => desiredEvent(state, b));
  const existing = (await eventsInRange(from, to)).filter((e) => e.calendarId === writeTo);
  const plan = planCalendarSync(desired, existing);

  for (const e of plan.create) {
    await CapacitorCalendar.createEvent({
      calendarId: writeTo,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      description: describeBlock(e.blockId),
    });
  }
  for (const e of plan.update) {
    await CapacitorCalendar.modifyEvent({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
    });
  }
  if (plan.remove.length > 0) await CapacitorCalendar.deleteEventsById({ ids: plan.remove });
  if (plan.create.length + plan.update.length + plan.remove.length > 0) {
    await CalendarSync.requestSync({ upload: true });
  }
}
