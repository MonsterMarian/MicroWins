import { describe, expect, it } from "vitest";
import {
  addTodo,
  countTodos,
  deleteTodo,
  isTodoExpired,
  purgeTodos,
  renameTodo,
  reorderTodos,
  sortedTodos,
  todoRemaining,
  toggleTodo,
  TODO_MAX_LENGTH,
} from "./todos";
import { EMPTY_STATE, TODO_TTL_MS, type MicroWinsState } from "./types";

const NOON = new Date("2026-08-13T12:00:00.000Z");

function hoursLater(hours: number): Date {
  return new Date(NOON.getTime() + hours * 60 * 60 * 1000);
}

/** Seznam s několika položkami v zadaném pořadí. */
function withTodos(...texts: string[]): MicroWinsState {
  return texts.reduce<MicroWinsState>((state, text) => addTodo(state, text, NOON).state, EMPTY_STATE);
}

describe("zakládání", () => {
  it("přidá položku na konec", () => {
    const state = withTodos("mléko", "chleba");

    expect(sortedTodos(state.todos).map((t) => t.text)).toEqual(["mléko", "chleba"]);
    expect(state.todos.every((t) => t.doneAt === null)).toBe(true);
  });

  it("prázdný text nezaloží nic", () => {
    const res = addTodo(EMPTY_STATE, "   ");

    expect(res.todo).toBeNull();
    expect(res.state).toBe(EMPTY_STATE);
  });

  it("okolní mezery zahodí a dlouhý text zkrátí", () => {
    const state = addTodo(EMPTY_STATE, `  ${"a".repeat(500)}  `).state;

    expect(state.todos[0].text).toHaveLength(TODO_MAX_LENGTH);
  });

  it("pořadí neopakuje ani po smazání prostřední položky", () => {
    const three = withTodos("a", "b", "c");
    const without = deleteTodo(three, three.todos[1].id);
    const state = addTodo(without, "d", NOON).state;

    const orders = state.todos.map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(sortedTodos(state.todos).map((t) => t.text)).toEqual(["a", "c", "d"]);
  });
});

describe("odškrtnutí", () => {
  it("posune položku pod otevřené", () => {
    const state = withTodos("první", "druhá", "třetí");
    const done = toggleTodo(state, state.todos[0].id, NOON);

    expect(sortedTodos(done.todos).map((t) => t.text)).toEqual(["druhá", "třetí", "první"]);
  });

  it("mezi odškrtnutými je nejnovější první", () => {
    const state = withTodos("a", "b");
    const first = toggleTodo(state, state.todos[0].id, NOON);
    const second = toggleTodo(first, first.todos[1].id, hoursLater(1));

    expect(sortedTodos(second.todos).map((t) => t.text)).toEqual(["b", "a"]);
  });

  it("vrácení mezi otevřené nuluje čas", () => {
    const state = withTodos("úkol");
    const done = toggleTodo(state, state.todos[0].id, NOON);
    const back = toggleTodo(done, state.todos[0].id, hoursLater(5));

    expect(back.todos[0].doneAt).toBeNull();
    expect(todoRemaining(back.todos[0], hoursLater(5))).toBe(1);
  });

  it("počítá otevřené a odškrtnuté", () => {
    const state = withTodos("a", "b", "c");
    const done = toggleTodo(state, state.todos[1].id, NOON);

    expect(countTodos(done.todos)).toEqual({ open: 2, done: 1 });
  });
});

describe("šest hodin do smazání", () => {
  it("otevřená položka nemizí nikdy", () => {
    const state = withTodos("úkol");

    expect(todoRemaining(state.todos[0], hoursLater(1000))).toBe(1);
    expect(isTodoExpired(state.todos[0], hoursLater(1000))).toBe(false);
    expect(purgeTodos(state, hoursLater(1000))).toBe(state);
  });

  it("zbývající čas ubývá lineárně", () => {
    const base = withTodos("úkol");
    const state = toggleTodo(base, base.todos[0].id, NOON);
    const todo = state.todos[0];

    expect(todoRemaining(todo, NOON)).toBe(1);
    expect(todoRemaining(todo, hoursLater(3))).toBeCloseTo(0.5, 5);
    expect(todoRemaining(todo, hoursLater(6))).toBe(0);
  });

  it("zbývající čas se nepropadne pod nulu", () => {
    const base = withTodos("úkol");
    const state = toggleTodo(base, base.todos[0].id, NOON);

    expect(todoRemaining(state.todos[0], hoursLater(50))).toBe(0);
  });

  it("po šesti hodinách položka zmizí, dřív ne", () => {
    const base = withTodos("hotová", "otevřená");
    const state = toggleTodo(base, base.todos[0].id, NOON);

    expect(purgeTodos(state, hoursLater(5.9)).todos).toHaveLength(2);
    expect(purgeTodos(state, hoursLater(6)).todos.map((t) => t.text)).toEqual(["otevřená"]);
  });

  it("hranice šesti hodin sedí na TODO_TTL_MS", () => {
    const base = withTodos("hotová");
    const state = toggleTodo(base, base.todos[0].id, NOON);
    const deadline = new Date(NOON.getTime() + TODO_TTL_MS);

    expect(isTodoExpired(state.todos[0], new Date(deadline.getTime() - 1))).toBe(false);
    expect(isTodoExpired(state.todos[0], deadline)).toBe(true);
  });

  it("bez čeho mazat vrací tentýž stav", () => {
    const state = withTodos("a", "b");

    // Identita se hlídá schválně: pravidelný tik v provideru by jinak
    // překresloval obrazovku každou minutu.
    expect(purgeTodos(state, hoursLater(1))).toBe(state);
  });
});

describe("úpravy", () => {
  it("přepíše text", () => {
    const state = withTodos("mlko");
    const fixed = renameTodo(state, state.todos[0].id, "  mléko  ");

    expect(fixed.todos[0].text).toBe("mléko");
  });

  it("prázdným textem se položka nevymaže", () => {
    const state = withTodos("mléko");

    expect(renameTodo(state, state.todos[0].id, "  ")).toBe(state);
  });

  it("smaže položku, neznámé id nechá stav být", () => {
    const state = withTodos("a", "b");

    expect(deleteTodo(state, state.todos[0].id).todos.map((t) => t.text)).toEqual(["b"]);
    expect(deleteTodo(state, "neexistuje")).toBe(state);
  });

  it("přetažením přeskládá otevřené položky", () => {
    const state = withTodos("a", "b", "c");
    const ids = sortedTodos(state.todos).map((t) => t.id);
    const moved = reorderTodos(state, [ids[2], ids[0], ids[1]]);

    expect(sortedTodos(moved.todos).map((t) => t.text)).toEqual(["c", "a", "b"]);
  });

  it("odškrtnuté položky přetahování otevřených nezamíchá", () => {
    const base = withTodos("a", "b", "hotová");
    const state = toggleTodo(base, base.todos[2].id, NOON);
    const open = sortedTodos(state.todos).filter((t) => !t.doneAt);
    const moved = reorderTodos(state, [open[1].id, open[0].id]);

    expect(sortedTodos(moved.todos).map((t) => t.text)).toEqual(["b", "a", "hotová"]);
  });
});
