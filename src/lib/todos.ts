import { fromISODate, todayISO, toISODate } from "./date";
import { TODO_TTL_MS, type ISODate, type MicroWinsState, type Todo } from "./types";
import { createId } from "./utils";

/**
 * ToDo - jednoduchý seznam.
 *
 * Celá logika je v jedné myšlence: položka je buď otevřená, nebo odškrtnutá,
 * a odškrtnutá má svůj čas. Nastavovat na ní není skoro co - jediné, co si
 * může přibrat, je termín, a ten se přidává **až potom**, co položka vznikne.
 * Zakládání tím zůstane na "napsat a Enter", což je celý smysl seznamu.
 *
 * Odškrtnutím se položka **jen posune dolů** a začne jí běžet čas do smazání
 * (výchozí šest hodin, jde přenastavit i vypnout). Nemazat hned má dva důvody:
 * omylem odškrtnutá věc se dá vrátit a odpoledne je vidět, co za den odpadlo.
 * Mazat později by zase znamenalo vést druhý archiv - na to jsou projekty.
 *
 * Čisté funkce, žádný React ani localStorage - viz todos.test.ts.
 */

/** Kolik znaků se vejde do jedné položky. Delší text už je popis, ne úkol. */
export const TODO_MAX_LENGTH = 200;

export function addTodo(
  state: MicroWinsState,
  text: string,
  now: Date = new Date(),
): { state: MicroWinsState; todo: Todo | null } {
  const trimmed = text.trim().slice(0, TODO_MAX_LENGTH);
  if (!trimmed) return { state, todo: null };

  const todo: Todo = {
    id: createId("tdo"),
    text: trimmed,
    createdAt: now.toISOString(),
    doneAt: null,
    // Nová položka patří na konec otevřených, ne na začátek: seznam se čte
    // shora dolů a přeskakující první řádek by při psaní pletl.
    order: state.todos.reduce((max, t) => Math.max(max, t.order + 1), 0),
    dueDate: null,
    dueTime: null,
  };
  return { state: { ...state, todos: [...state.todos, todo] }, todo };
}

export function renameTodo(state: MicroWinsState, id: string, text: string): MicroWinsState {
  const trimmed = text.trim().slice(0, TODO_MAX_LENGTH);
  if (!trimmed) return state;
  return {
    ...state,
    todos: state.todos.map((t) => (t.id === id ? { ...t, text: trimmed } : t)),
  };
}

/**
 * Přepne odškrtnutí. Vrácení zpět mezi otevřené čas nuluje - položka, která se
 * odškrtla omylem, nesmí za deset minut zmizet jako ta, co se opravdu udělala.
 */
export function toggleTodo(
  state: MicroWinsState,
  id: string,
  now: Date = new Date(),
): MicroWinsState {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return state;
  return {
    ...state,
    todos: state.todos.map((t) =>
      t.id === id ? { ...t, doneAt: t.doneAt ? null : now.toISOString() } : t,
    ),
  };
}

export function deleteTodo(state: MicroWinsState, id: string): MicroWinsState {
  if (!state.todos.some((t) => t.id === id)) return state;
  return { ...state, todos: state.todos.filter((t) => t.id !== id) };
}

/**
 * Vrátí smazanou položku zpátky.
 *
 * Bere celý objekt, ne id: po smazání už ve stavu není odkud vyčíst text,
 * pořadí ani odškrtnutí. Protože `deleteTodo` ostatním položkám pořadí
 * nepřečísluje, sedne vrácená přesně tam, odkud zmizela.
 */
export function restoreTodo(state: MicroWinsState, todo: Todo): MicroWinsState {
  if (state.todos.some((t) => t.id === todo.id)) return state;
  return { ...state, todos: [...state.todos, todo] };
}

/** Nové pořadí otevřených položek po přetažení. */
export function reorderTodos(state: MicroWinsState, ids: string[]): MicroWinsState {
  const byId = new Map(ids.map((id, index) => [id, index]));
  if (byId.size === 0) return state;
  return {
    ...state,
    todos: state.todos.map((t) => {
      const order = byId.get(t.id);
      return order === undefined || order === t.order ? t : { ...t, order };
    }),
  };
}

// --- termín -----------------------------------------------------------------

/**
 * Nastaví (nebo sundá) termín. Hodina bez data se zahazuje - "ve tři" bez dne
 * není termín, ale přání; a tichý default na dnešek by položce podstrčil den,
 * o kterém uživatel nic neřekl.
 */
export function setTodoDue(
  state: MicroWinsState,
  id: string,
  dueDate: ISODate | null,
  dueTime: string | null = null,
): MicroWinsState {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return state;
  const date = dueDate || null;
  const time = date && dueTime && isValidTime(dueTime) ? padTime(dueTime) : null;
  if (todo.dueDate === date && todo.dueTime === time) return state;
  return {
    ...state,
    todos: state.todos.map((t) => (t.id === id ? { ...t, dueDate: date, dueTime: time } : t)),
  };
}

export function isValidTime(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** "9:05" -> "09:05", ať se termíny dají porovnávat i jako text. */
function padTime(value: string): string {
  const [h, m] = value.trim().split(":");
  return `${h.padStart(2, "0")}:${m}`;
}

/** Okamžik termínu. Den bez hodiny končí o půlnoci - do té doby je to "dnes". */
export function todoDueAt(todo: Todo): Date | null {
  if (!todo.dueDate) return null;
  const d = fromISODate(todo.dueDate);
  if (todo.dueTime) {
    const [h, m] = todo.dueTime.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

/** Otevřená položka, které termín utekl. Odškrtnutá už po termínu být nemůže. */
export function isTodoOverdue(todo: Todo, now: Date = new Date()): boolean {
  if (todo.doneAt) return false;
  const due = todoDueAt(todo);
  return due !== null && due.getTime() < now.getTime();
}

/** Termín do hodiny (a ještě nepropadlý) - v seznamu si zaslouží víc pozornosti. */
export function isTodoDueSoon(todo: Todo, now: Date = new Date()): boolean {
  if (todo.doneAt) return false;
  const due = todoDueAt(todo);
  if (!due) return false;
  const left = due.getTime() - now.getTime();
  return left >= 0 && left <= 60 * 60 * 1000;
}

const DAY_SHORT = ["ne", "po", "út", "st", "čt", "pá", "so"];

/**
 * Krátký popisek termínu do řádku: "dnes 14:00", "zítra", "pá 9:00", "3. 9.".
 * Bez roku a bez slova "termín" - v řádku je na to místo tak akorát a hodinky
 * vedle napoví zbytek.
 */
export function formatTodoDue(todo: Todo, now: Date = new Date()): string {
  if (!todo.dueDate) return "";
  const today = toISODate(now);
  const day = fromISODate(todo.dueDate);
  const diff = Math.round((day.getTime() - fromISODate(today).getTime()) / 86_400_000);

  let label: string;
  if (diff === 0) label = "dnes";
  else if (diff === 1) label = "zítra";
  else if (diff === -1) label = "včera";
  else if (diff > 1 && diff < 7) label = DAY_SHORT[day.getDay()];
  else label = `${day.getDate()}. ${day.getMonth() + 1}.`;

  return todo.dueTime ? `${label} ${stripLeadingZero(todo.dueTime)}` : label;
}

function stripLeadingZero(time: string): string {
  return time.startsWith("0") ? time.slice(1) : time;
}

/**
 * Nabídka termínů na jedno ťuknutí. Pokrývá to, co se do seznamu na dnešek
 * píše nejčastěji; cokoliv jiného se doťuká v polích pod nimi.
 */
export interface DueSuggestion {
  id: string;
  label: string;
  date: ISODate;
  time: string | null;
}

export function dueSuggestions(now: Date = new Date()): DueSuggestion[] {
  const today = toISODate(now);
  const tomorrow = toISODate(new Date(now.getTime() + 86_400_000));
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const hourLabel = `${inHour.getHours()}:${String(inHour.getMinutes()).padStart(2, "0")}`;

  return [
    { id: "hour", label: `Za hodinu · ${hourLabel}`, date: toISODate(inHour), time: hourLabel },
    { id: "evening", label: "Dnes večer · 18:00", date: today, time: "18:00" },
    { id: "tomorrow", label: "Zítra ráno · 9:00", date: tomorrow, time: "09:00" },
    { id: "today", label: "Dnes, bez hodiny", date: today, time: null },
  ];
}

/** Otevřené položky s termínem, nejbližší první - podklad pro plán dne. */
export function dueTodos(todos: Todo[]): Todo[] {
  return todos
    .filter((t) => !t.doneAt && t.dueDate)
    .sort((a, b) => (todoDueAt(a)?.getTime() ?? 0) - (todoDueAt(b)?.getTime() ?? 0));
}

/** Kolik otevřených položek má termín na dnešek nebo dřív. */
export function todosDueToday(todos: Todo[], today: ISODate = todayISO()): number {
  return todos.filter((t) => !t.doneAt && t.dueDate !== null && t.dueDate <= today).length;
}

// --- čas do smazání ---------------------------------------------------------

/**
 * Doba do smazání v milisekundách. `0` (a cokoliv menšího) znamená **vypnuto**:
 * odškrtnuté položky pak zůstanou, dokud je někdo nesmaže sám.
 *
 * Chodí sem hodnota z Nastavení, proto ta nula: jinak by se stejná věc musela
 * tahat přes všechny funkce podruhé jako `enabled`.
 */
export type TodoTtl = number;

function ttlOff(ttlMs: TodoTtl): boolean {
  return !Number.isFinite(ttlMs) || ttlMs <= 0;
}

/**
 * Kolik z odměřeného času ještě zbývá, jako podíl 0-1. Otevřená položka vrací
 * 1, dojetá 0. Z podílu se kreslí ubývající pruh - proto podíl a ne minuty:
 * pruh nemá říkat čas, na to je vedle něj text.
 */
export function todoRemaining(
  todo: Todo,
  now: Date = new Date(),
  ttlMs: TodoTtl = TODO_TTL_MS,
): number {
  if (!todo.doneAt) return 1;
  if (ttlOff(ttlMs)) return 1;
  const elapsed = now.getTime() - new Date(todo.doneAt).getTime();
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(1, Math.max(0, 1 - elapsed / ttlMs));
}

/** Kolik milisekund zbývá do smazání. `null` = nemaže se (vypnuto nebo otevřená). */
export function todoRemainingMs(
  todo: Todo,
  now: Date = new Date(),
  ttlMs: TodoTtl = TODO_TTL_MS,
): number | null {
  if (!todo.doneAt || ttlOff(ttlMs)) return null;
  const left = new Date(todo.doneAt).getTime() + ttlMs - now.getTime();
  return Number.isFinite(left) ? Math.max(0, left) : 0;
}

/**
 * "zmizí za 5 h", "zmizí za 12 min". Hodiny se nedrobí na minuty schválně -
 * u pěti hodin nikoho nezajímá, jestli je jich 5:12 nebo 5:47, a přesné číslo
 * by z tiché poznámky udělalo odpočet.
 */
export function formatRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "za chvíli";
  if (minutes < 60) return `za ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `za ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "za den" : `za ${days} dny`;
}

/** Popisek doby v Nastavení a v patičce seznamu: "6 h", "30 min", "1 den". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 den" : `${days} dny`;
}

/** Položka, které vypršel čas - `purgeTodos` ji zahodí. */
export function isTodoExpired(
  todo: Todo,
  now: Date = new Date(),
  ttlMs: TodoTtl = TODO_TTL_MS,
): boolean {
  if (ttlOff(ttlMs)) return false;
  return todo.doneAt !== null && todoRemaining(todo, now, ttlMs) <= 0;
}

/**
 * Zahodí odškrtnuté položky, kterým vypršel čas.
 *
 * Vrací **stejný stav**, když není co mazat. Bez toho by se pravidelný tik
 * v provideru překresloval každou minutu a s ním celá obrazovka.
 */
export function purgeTodos(
  state: MicroWinsState,
  now: Date = new Date(),
  ttlMs: TodoTtl = TODO_TTL_MS,
): MicroWinsState {
  if (ttlOff(ttlMs)) return state;
  const kept = state.todos.filter((t) => !isTodoExpired(t, now, ttlMs));
  return kept.length === state.todos.length ? state : { ...state, todos: kept };
}

// --- výpis ------------------------------------------------------------------

/**
 * Otevřené ve vlastním pořadí, odškrtnuté pod nimi. Mezi odškrtnutými je
 * nejnovější první, takže položka postupně klesá a nakonec zmizí odspodu -
 * pohyb dolů tím znamená totéž jako ubývající pruh.
 *
 * Termín pořadím nehýbe: seznam si uživatel skládá prstem a přeskakující
 * řádek by mu tu práci bral. Termín se hlásí barvou, ne pozicí.
 */
export function sortedTodos(todos: Todo[]): Todo[] {
  const open = todos
    .filter((t) => !t.doneAt)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  const done = todos
    .filter((t) => t.doneAt)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  return [...open, ...done];
}

export interface TodoCounts {
  open: number;
  done: number;
}

export function countTodos(todos: Todo[]): TodoCounts {
  const done = todos.filter((t) => t.doneAt).length;
  return { open: todos.length - done, done };
}
