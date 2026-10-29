import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { CapacitorCalendar, type CalendarEvent } from "@ebarooni/capacitor-calendar";
import { addDays, fromISODate, toISODate } from "./date";
import { isNative } from "./native";
import { blockTitle, DAY_MINUTES, pinsOfDay } from "./timeblocks";
import { parsePriorityRef, placeCount, placesOf } from "./timebox";
import type { ISODate, MicroWinsState, TimeBlock, Todo } from "./types";

/**
 * Napojení time boxu na kalendář v telefonu - a přes něj na Google Kalendář.
 *
 * Appka nemluví s Googlem přímo: telefon si Google kalendář synchronizuje sám
 * a appka čte a zapisuje do systémového kalendáře (Android CalendarContract).
 * Nepotřebuje tak OAuth, server ani tajný klíč a jede i offline. O
 * synchronizaci s Googlem si appka řekne sama (`CalendarSync`) - s vypnutou
 * automatickou synchronizací účtů by ji Android neudělal.
 *
 * Dvě části, obě nepovinné a nastavené **jen pro tohle zařízení** (id
 * kalendářů jsou v každém telefonu jiná, proto ne v `prefs`, které se
 * synchronizují):
 *
 * - **čtení**: události ze všech viditelných kalendářů se v mřížce ukážou jako
 *   „obsazeno". Nejsou to bloky, nic se z nich neukládá.
 * - **zrcadlo**: bloky a termíny ToDo s hodinou (ty, které ještě nejsou v
 *   mřížce) se zrcadlí do jednoho vybraného kalendáře, **oběma směry**:
 *   přejmenování, posun, odškrtnutí (✓ na začátku názvu) i smazání v Googlu
 *   se propíše zpátky do appky. Kdo co změnil, se pozná ze „základu" - jak
 *   událost vypadala po posledním běhu (viz `planMirror`). Událost se s blokem
 *   či položkou páruje značkou `microwins:<id>` v popisu, takže appka
 *   nepotřebuje vlastní tabulku a přeinstalace nevyrobí duplikáty.
 *
 * Čisté funkce (`dayEvents`, `mirrorItems`, `planMirror`, `applyPulls`, …) jsou
 * testované v calendar.test.ts; zbytek je tenký most k pluginu, v prohlížeči
 * nedělá nic.
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

// --- zrcadlo: co appka v kalendáři chce mít ---------------------------------

const MARKER = "microwins:";
// Bez nároku na mezeru před značkou: popis upravený na webu vrátí Google jako
// HTML (`<br>microwins:…`) a ztracená značka by znamenala duplikát navždy.
const MARKER_RE = /microwins:([A-Za-z0-9_-]+)/;

/** Id bloku či položky ze značky v popisu události; null = událost appce nepatří. */
export function markerOf(description: string | null): string | null {
  return description?.match(MARKER_RE)?.[1] ?? null;
}

export function mirrorDescription(key: string): string {
  return `Z MicroWins - ✓ na začátku názvu = hotovo, smazání smaže i v appce.\n${MARKER}${key}`;
}

/** Blok, nebo termín ToDo s hodinou, tak jak má v kalendáři stát. */
export interface MirrorItem {
  /** Id bloku či položky ToDo - totéž, co nese značka v popisu. */
  key: string;
  kind: "block" | "todo";
  /** Název bez ✓. */
  title: string;
  done: boolean;
  startDate: number;
  endDate: number;
}

const DONE_RE = /^[✓✔☑✅]\s*/u;

/** Název události: odškrtnutí je ✓ na začátku. */
export function eventTitle(item: Pick<MirrorItem, "title" | "done">): string {
  return item.done ? `✓ ${item.title}` : item.title;
}

/** Opak `eventTitle` - v Googlu jde odškrtnout i ✔, ☑ nebo ✅. */
export function parseEventTitle(title: string): { title: string; done: boolean } {
  return { title: title.replace(DONE_RE, "").trim(), done: DONE_RE.test(title) };
}

function span(date: ISODate, start: number, duration: number) {
  const d = fromISODate(date);
  // Minuty přes `setHours` - Date sám přepočte přechod na letní čas.
  d.setHours(0, start, 0, 0);
  return { startDate: d.getTime(), endDate: d.getTime() + duration * 60_000 };
}

/**
 * Od kterého dne se zrcadlí: od včerejška, dopředu bez omezení. Události
 * starších dnů zůstanou v kalendáři jako historie.
 */
export function mirrorFrom(today: ISODate): ISODate {
  return addDays(today, -1);
}

/**
 * Co má v kalendáři stát: bloky od `from` a otevřené ToDo s termínem a
 * hodinou, které ještě nejsou v mřížce (stopy z `pinsOfDay`). Naplánované
 * ToDo zastupuje jeho blok, odškrtnuté z kalendáře mizí.
 */
export function mirrorItems(state: MicroWinsState, from: ISODate): MirrorItem[] {
  const blocks: MirrorItem[] = state.timeBlocks
    .filter((b) => b.date >= from)
    .map((b) => ({
      key: b.id,
      kind: "block" as const,
      title: blockTitle(state, b) || "Blok",
      done: b.doneAt !== null,
      ...span(b.date, b.start, b.duration),
    }));
  const dates = new Set(
    state.todos
      .filter((t) => t.doneAt === null && t.dueTime !== null && t.dueDate !== null && t.dueDate >= from)
      .map((t) => t.dueDate as ISODate),
  );
  const todos: MirrorItem[] = [...dates].flatMap((date) =>
    pinsOfDay(state, date).map(({ todo, start, duration }) => ({
      key: todo.id,
      kind: "todo" as const,
      title: todo.text,
      done: false,
      ...span(date, start, duration),
    })),
  );
  return [...blocks, ...todos];
}

// --- zrcadlo: plán oběma směry ----------------------------------------------

/** Událost zrcadla tak, jak je v kalendáři. */
export interface MirrorEvent {
  id: string;
  key: string;
  title: string;
  startDate: number;
  endDate: number;
  allDay: boolean;
  recurring: boolean;
}

/** Jak událost vypadala po posledním běhu - podle toho se pozná, kdo co změnil. */
export interface MirrorBase {
  eventId: string;
  title: string;
  startDate: number;
  endDate: number;
}

/** Změna z kalendáře, kterou má převzít appka. */
export interface MirrorPull {
  key: string;
  kind: "block" | "todo";
  /** Událost v kalendáři smazaná. */
  deleted?: boolean;
  title?: string;
  done?: boolean;
  startDate?: number;
  endDate?: number;
}

export interface MirrorPlan {
  create: MirrorItem[];
  update: (MirrorItem & { id: string })[];
  remove: string[];
  pull: MirrorPull[];
  /** Základ pro příští běh - bez událostí, které se teprve založí (ty doplní zápis). */
  base: Record<string, MirrorBase>;
}

type Shape = Pick<MirrorBase, "title" | "startDate" | "endDate">;

function same(a: Shape, b: Shape): boolean {
  return a.title === b.title && a.startDate === b.startDate && a.endDate === b.endDate;
}

/** Co se v kalendáři změnilo oproti základu. Prázdný název se nepřebírá. */
function pullOf(item: MirrorItem, event: MirrorEvent, was: MirrorBase): MirrorPull | null {
  const pull: MirrorPull = { key: item.key, kind: item.kind };
  const now = parseEventTitle(event.title);
  const before = parseEventTitle(was.title);
  if (now.title !== "" && now.title !== before.title) pull.title = now.title;
  if (now.done !== before.done) pull.done = now.done;
  // Celodenní či opakovaná událost čas bloku nemá jak nést - vrátí se zpátky.
  const timed = !event.allDay && !event.recurring && event.endDate > event.startDate;
  if (timed && (event.startDate !== was.startDate || event.endDate !== was.endDate)) {
    pull.startDate = event.startDate;
    pull.endDate = event.endDate;
  }
  return Object.keys(pull).length > 2 ? pull : null;
}

/**
 * Co udělat, aby kalendář a appka odpovídaly jedno druhému.
 *
 * Tři strany: co chce appka (`items`), co je v kalendáři (`events`) a jak to
 * vypadalo po posledním běhu (`base`). Změnil se jen kalendář → appka to
 * převezme (`pull`); změnila se appka nebo obojí → vyhrává appka a událost se
 * přepíše. Bez základu (první běh, nový telefon) vyhrává appka - nic se
 * nepřebírá naslepo.
 *
 * Událost, která zmizela, ač ji základ zná, je smazaná v kalendáři → appka
 * smaže blok, ToDo odškrtne. Zmizí-li ale skoro všechno naráz, je to spíš
 * odpojený či vyprázdněný kalendář než mazání - pak se nic nemaže a události
 * se založí znovu.
 *
 * Události bez protějšku v `items` se mažou, kromě historie: bloků a ToDo
 * starších dnů (`history.pastKeys`) a starých událostí, které už základ nezná.
 * Cizí události (bez značky) sem vůbec nechodí.
 */
export function planMirror(
  items: MirrorItem[],
  events: MirrorEvent[],
  base: Record<string, MirrorBase>,
  history: { from: number; pastKeys: Set<string> },
): MirrorPlan {
  const plan: MirrorPlan = { create: [], update: [], remove: [], pull: [], base: {} };
  const byKey = new Map<string, MirrorEvent[]>();
  // Nejstarší událost za klíč je ta pravá, další jsou duplikáty.
  for (const e of [...events].sort((a, b) => Number(a.id) - Number(b.id))) {
    byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  }
  const gone: MirrorItem[] = [];

  for (const item of items) {
    const [event, ...extra] = byKey.get(item.key) ?? [];
    byKey.delete(item.key);
    plan.remove.push(...extra.map((e) => e.id));
    const was = base[item.key];
    const want: Shape = { title: eventTitle(item), startDate: item.startDate, endDate: item.endDate };

    if (!event) {
      if (was) gone.push(item);
      else plan.create.push(item);
      continue;
    }
    const remoteChanged = was !== undefined && !same(event, was);
    const appChanged = was === undefined || !same(want, was);
    if (remoteChanged && !appChanged) {
      const pull = pullOf(item, event, was);
      if (pull) plan.pull.push(pull);
      // Základ = kalendář: co appka převzít neumí (celodenní, prázdný název),
      // příští běh pozná jako rozdíl appky a vrátí zpátky.
      plan.base[item.key] = { eventId: event.id, title: event.title, startDate: event.startDate, endDate: event.endDate };
      continue;
    }
    if (!same(want, event) || event.allDay) plan.update.push({ ...item, id: event.id });
    plan.base[item.key] = { eventId: event.id, ...want };
  }

  const known = Object.keys(base).length;
  if (gone.length >= 3 && gone.length > known / 2) plan.create.push(...gone);
  else plan.pull.push(...gone.map((item) => ({ key: item.key, kind: item.kind, deleted: true })));

  for (const [key, list] of byKey) {
    for (const e of list) {
      const isHistory = history.pastKeys.has(key) || (e.endDate <= history.from && !base[key]);
      if (!isHistory) plan.remove.push(e.id);
    }
  }
  return plan;
}

// --- zrcadlo: převzetí změn z kalendáře do appky -----------------------------

/** Akce úložiště, kterými se změny z kalendáře propisují (stejné jako z UI). */
export interface MirrorApi {
  updateBlock: (
    id: string,
    patch: { title?: string; start?: number; duration?: number; date?: ISODate },
  ) => void;
  toggleBlockDone: (id: string) => void;
  deleteBlock: (id: string) => TimeBlock | null;
  renameEverywhere: (date: ISODate, from: string, to: string) => void;
  setPriority: (date: ISODate, index: number, text: string) => void;
  renameTodo: (id: string, text: string) => void;
  toggleTodo: (id: string) => void;
  setTodoDue: (id: string, dueDate: ISODate | null, dueTime?: string | null) => void;
}

/** Co se z kalendáře smazalo či odškrtlo - appka to ohlásí s „Vrátit“. */
export interface PulledRemovals {
  blocks: TimeBlock[];
  todos: Todo[];
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Přejmenování bloku míří tam, odkud blok název bere. */
function renameBlock(state: MicroWinsState, block: TimeBlock, text: string, api: MirrorApi): void {
  if (block.todoId && state.todos.some((t) => t.id === block.todoId)) {
    api.renameTodo(block.todoId, text);
    return;
  }
  const priority = parsePriorityRef(block.priorityId);
  if (priority) {
    api.setPriority(priority.date, priority.index, text);
    return;
  }
  // Název drží úkol projektu - z kalendáře se nepřepisuje, příští běh ho vrátí.
  if (block.taskId) return;
  const before = blockTitle(state, block);
  // Věc je i v dumpu či trojce - přepsaný text platí všude (jako v mřížce).
  if (placeCount(placesOf(state, block.date, before)) > 1) {
    api.renameEverywhere(block.date, before, text);
  }
  api.updateBlock(block.id, { title: text });
}

/** Provede změny z kalendáře v appce - stejnými akcemi, jaké volá UI. */
export function applyPulls(state: MicroWinsState, pulls: MirrorPull[], api: MirrorApi): PulledRemovals {
  const out: PulledRemovals = { blocks: [], todos: [] };
  for (const pull of pulls) {
    if (pull.kind === "block") {
      const block = state.timeBlocks.find((b) => b.id === pull.key);
      if (!block) continue;
      if (pull.deleted) {
        const removed = api.deleteBlock(block.id);
        if (removed) out.blocks.push(removed);
        continue;
      }
      if (pull.title !== undefined) renameBlock(state, block, pull.title, api);
      if (pull.startDate !== undefined && pull.endDate !== undefined) {
        const d = new Date(pull.startDate);
        api.updateBlock(block.id, {
          date: toISODate(d),
          start: d.getHours() * 60 + d.getMinutes(),
          duration: Math.round((pull.endDate - pull.startDate) / 60_000),
        });
      }
      if (pull.done !== undefined && pull.done !== (block.doneAt !== null)) {
        api.toggleBlockDone(block.id);
      }
      continue;
    }
    const todo = state.todos.find((t) => t.id === pull.key);
    if (!todo) continue;
    if (pull.title !== undefined) api.renameTodo(todo.id, pull.title);
    if (pull.startDate !== undefined) {
      const d = new Date(pull.startDate);
      api.setTodoDue(todo.id, toISODate(d), hhmm(d));
    }
    // Smazaný termín ToDo = hotovo: odškrtnutá položka jde vrátit, smazaná ne.
    if ((pull.deleted || pull.done) && todo.doneAt === null) {
      api.toggleTodo(todo.id);
      out.todos.push(todo);
    }
  }
  return out;
}

// --- most k pluginu ------------------------------------------------------------

/**
 * Vlastní plugin (android/…/CalendarSyncPlugin.java): ruční synchronizace s
 * Googlem - s vypnutou automatickou synchronizací účtů by jinak nic neodešlo
 * ani nepřišlo -, události zrcadla a hlášení změn kalendáře v telefonu.
 */
interface CalendarSyncPlugin {
  requestSync(options: { upload: boolean }): Promise<void>;
  mirrorEvents(options: { calendarId: string }): Promise<{
    ok: boolean;
    events: {
      id: string;
      title: string;
      description: string;
      startDate: number;
      endDate: number;
      allDay: boolean;
      recurring: boolean;
    }[];
  }>;
  watch(): Promise<void>;
  addListener(event: "change", fn: () => void): Promise<PluginListenerHandle>;
}

const CalendarSync = registerPlugin<CalendarSyncPlugin>("CalendarSync");

/**
 * Umí tahle instalace kalendář? Web dorazí přes OTA i do starších APK, ale
 * nativní pluginy přináší jen nové APK - bez nich by sekce jen hlásila chybu.
 */
export function calendarAvailable(): boolean {
  return (
    isNative() &&
    Capacitor.isPluginAvailable("CapacitorCalendar") &&
    Capacitor.isPluginAvailable("CalendarSync")
  );
}

let lastSync = 0;

/**
 * Stáhne z Googlu novinky do kalendářů telefonu (a odešle, co čeká). Nejvýš
 * jednou za minutu - ptá se mřížka při každém otevření i zrcadlo po návratu.
 */
export async function syncPhoneCalendars(): Promise<void> {
  if (!calendarAvailable()) return;
  if (Date.now() - lastSync < 60_000) return;
  lastSync = Date.now();
  try {
    await CalendarSync.requestSync({ upload: false });
  } catch {
    // bez přístupu nebo bez sítě - zkusí se při dalším návratu do appky
  }
}

/** Zavolá `fn` při každé změně kalendáře v telefonu (i po synchronizaci). */
export function onCalendarChange(fn: () => void): () => void {
  if (!calendarAvailable()) return () => {};
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
  writable: boolean;
}

/** Zeptá se na přístup ke kalendáři. Odmítnutí = false, nic nespadne. */
export async function requestCalendarAccess(): Promise<boolean> {
  if (!calendarAvailable()) return false;
  try {
    const { result } = await CapacitorCalendar.requestFullCalendarAccess();
    return result === "granted";
  } catch {
    return false;
  }
}

/** Viditelné kalendáře telefonu. */
export async function listPhoneCalendars(): Promise<PhoneCalendar[]> {
  if (!calendarAvailable()) return [];
  const { result } = await CapacitorCalendar.listCalendars();
  return result
    .filter((c) => c.visible !== false)
    .map((c) => {
      // MIUI svůj kalendář jen v telefonu nepojmenuje, ukáže holý klíč překladu.
      const local = c.title?.startsWith("calendar_displayname") === true;
      return {
        id: c.id,
        title: local ? "Jen v telefonu (bez Googlu)" : (c.title ?? "Kalendář"),
        account: local ? "" : (c.accountName ?? ""),
        writable: c.allowsContentModifications === true,
      };
    });
}

/**
 * Události k zobrazení v mřížce: všechny viditelné kalendáře, jen bez zrcadla
 * (značka v popisu) - bloky a ToDo appka ukazuje sama, byly by tam dvakrát.
 * Celý cílový kalendář se schválně nevynechává: může to být ten hlavní se
 * schůzkami a zrcadlo z dřív vybraného kalendáře by se jinak vrátilo jako cizí.
 */
export async function readEvents(from: ISODate, to: ISODate): Promise<CalendarEvent[]> {
  if (!calendarAvailable() || !getCalendarSettings().read) return [];
  try {
    const shown = new Set((await listPhoneCalendars()).map((c) => c.id));
    const { result } = await CapacitorCalendar.listEventsInRange({
      from: dayStartMs(from),
      to: dayStartMs(addDays(to, 1)),
    });
    return result.filter(
      (e) => e.calendarId && shown.has(e.calendarId) && !markerOf(e.description),
    );
  } catch {
    // přístup odebraný v systému - mřížka prostě bude bez událostí
    return [];
  }
}

const BASE_KEY = "microwins:calendar-base";

/** Základ zrcadla - jen pro kalendář, ke kterému patří; jinak prázdný. */
function loadBase(calendarId: string): Record<string, MirrorBase> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(BASE_KEY) ?? "null");
    return raw?.calendarId === calendarId && raw.items && typeof raw.items === "object" ? raw.items : {};
  } catch {
    return {};
  }
}

function saveBase(calendarId: string, items: Record<string, MirrorBase>): void {
  try {
    window.localStorage.setItem(BASE_KEY, JSON.stringify({ calendarId, items }));
  } catch {
    // bez úložiště se příště nic nepřevezme - appka jen přepíše kalendář
  }
}

/** Zahodí základ, patří-li kalendáři `calendarId` (zrcadlo z něj je pryč). */
function dropBase(calendarId: string): void {
  try {
    const raw = JSON.parse(window.localStorage.getItem(BASE_KEY) ?? "null");
    if (raw?.calendarId === calendarId) window.localStorage.removeItem(BASE_KEY);
  } catch {
    // nevadí - základ jiného kalendáře se stejně nepoužije
  }
}

async function mirrorEvents(calendarId: string): Promise<{ ok: boolean; events: MirrorEvent[] }> {
  const { ok, events } = await CalendarSync.mirrorEvents({ calendarId });
  return {
    ok,
    events: events.flatMap((e) => {
      const key = markerOf(e.description);
      return key ? [{ ...e, key }] : [];
    }),
  };
}

export interface MirrorRun {
  /** Změny z kalendáře, které má appka převzít (`applyPulls`). */
  pull: MirrorPull[];
  /** Uloží základ - až po převzetí, ať se při pádu mezi tím převezme znovu. */
  commit: () => void;
}

/**
 * Jeden běh zrcadla: přečte kalendář, zapíše do něj změny appky a vrátí
 * změny z kalendáře. O synchronizaci s Googlem si řekne po zápisu, a s
 * `syncAlways` (start a návrat do appky) vždy - i kvůli stažení novinek.
 */
export async function syncMirror(
  state: MicroWinsState,
  today: ISODate,
  syncAlways = false,
): Promise<MirrorRun> {
  const idle: MirrorRun = { pull: [], commit: () => {} };
  const { writeTo } = getCalendarSettings();
  if (!calendarAvailable() || !writeTo) return idle;
  const { ok, events } = await mirrorEvents(writeTo);
  // Kalendář zmizel nebo nestahuje události: nesahat na nic - chybějící
  // události by jinak vypadaly jako smazané.
  if (!ok) return idle;

  const from = mirrorFrom(today);
  const base = loadBase(writeTo);
  const pastKeys = new Set([
    ...state.timeBlocks.filter((b) => b.date < from).map((b) => b.id),
    ...state.todos.filter((t) => t.dueDate !== null && t.dueDate < from).map((t) => t.id),
  ]);
  const plan = planMirror(mirrorItems(state, from), events, base, {
    from: dayStartMs(from),
    pastKeys,
  });

  const next = { ...plan.base };
  for (const item of plan.create) {
    const { id } = await CapacitorCalendar.createEvent({
      calendarId: writeTo,
      title: eventTitle(item),
      startDate: item.startDate,
      endDate: item.endDate,
      description: mirrorDescription(item.key),
    });
    if (id) next[item.key] = { eventId: id, title: eventTitle(item), startDate: item.startDate, endDate: item.endDate };
  }
  for (const item of plan.update) {
    await CapacitorCalendar.modifyEvent({
      id: item.id,
      title: eventTitle(item),
      startDate: item.startDate,
      endDate: item.endDate,
      // Celodenní z Googlu se vrací na čas, přepsaný popis zpátky se značkou.
      isAllDay: false,
      description: mirrorDescription(item.key),
    });
  }
  if (plan.remove.length > 0) await CapacitorCalendar.deleteEventsById({ ids: plan.remove });

  const wrote = plan.create.length + plan.update.length + plan.remove.length > 0;
  if (syncAlways) {
    lastSync = Date.now();
    await CalendarSync.requestSync({ upload: false });
  } else if (wrote) {
    await CalendarSync.requestSync({ upload: true });
  }
  return { pull: plan.pull, commit: () => saveBase(writeTo, next) };
}

/**
 * Smaže zrcadlo z kalendáře, do kterého se přestává zapisovat (od včerejška,
 * starší zůstanou jako historie). Bez toho by tam bloky zůstaly navždy.
 */
export async function clearMirror(calendarId: string, today: ISODate): Promise<void> {
  if (!calendarAvailable()) return;
  const from = dayStartMs(mirrorFrom(today));
  const { events } = await mirrorEvents(calendarId);
  const ids = events.filter((e) => e.endDate > from).map((e) => e.id);
  if (ids.length > 0) {
    await CapacitorCalendar.deleteEventsById({ ids });
    await CalendarSync.requestSync({ upload: true });
  }
  dropBase(calendarId);
}
