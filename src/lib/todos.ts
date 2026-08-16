import { TODO_TTL_MS, type MicroWinsState, type Todo } from "./types";
import { createId } from "./utils";

/**
 * ToDo - jednoduchý seznam.
 *
 * Celá logika je v jedné myšlence: položka je buď otevřená, nebo odškrtnutá,
 * a odškrtnutá má svůj čas. Nic dalšího se o ní neví, takže není co nastavovat.
 *
 * Odškrtnutím se položka **jen posune dolů** a začne jí běžet šest hodin.
 * Nemazat hned má dva důvody: omylem odškrtnutá věc se dá vrátit a odpoledne
 * je vidět, co za den odpadlo. Mazat později by zase znamenalo vést druhý
 * archiv - na to jsou projekty.
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

// --- čas do smazání ---------------------------------------------------------

/**
 * Kolik z šesti hodin ještě zbývá, jako podíl 0-1. Otevřená položka vrací 1,
 * dojetá 0. Z podílu se kreslí ubývající pruh - proto podíl a ne minuty:
 * pruh nemá říkat čas, jen že se s tím něco děje.
 */
export function todoRemaining(todo: Todo, now: Date = new Date()): number {
  if (!todo.doneAt) return 1;
  const elapsed = now.getTime() - new Date(todo.doneAt).getTime();
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(1, Math.max(0, 1 - elapsed / TODO_TTL_MS));
}

/** Položka, které vypršel čas - `purgeTodos` ji zahodí. */
export function isTodoExpired(todo: Todo, now: Date = new Date()): boolean {
  return todo.doneAt !== null && todoRemaining(todo, now) <= 0;
}

/**
 * Zahodí odškrtnuté položky, kterým vypršel čas.
 *
 * Vrací **stejný stav**, když není co mazat. Bez toho by se pravidelný tik
 * v provideru překresloval každou minutu a s ním celá obrazovka.
 */
export function purgeTodos(state: MicroWinsState, now: Date = new Date()): MicroWinsState {
  const kept = state.todos.filter((t) => !isTodoExpired(t, now));
  return kept.length === state.todos.length ? state : { ...state, todos: kept };
}

// --- výpis ------------------------------------------------------------------

/**
 * Otevřené ve vlastním pořadí, odškrtnuté pod nimi. Mezi odškrtnutými je
 * nejnovější první, takže položka postupně klesá a nakonec zmizí odspodu -
 * pohyb dolů tím znamená totéž jako ubývající pruh.
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
