import { describe, expect, it } from "vitest";
import { toISODate } from "./date";
import {
  addTodo,
  countTodos,
  deleteTodo,
  dueSuggestions,
  formatDuration,
  formatRemaining,
  formatTodoDue,
  isTodoDueSoon,
  isTodoExpired,
  isTodoOverdue,
  purgeTodos,
  renameTodo,
  reorderTodos,
  restoreTodo,
  setTodoDue,
  sortedTodos,
  todoRemaining,
  todoRemainingMs,
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

  /* Koš maže hned a hláška nabízí "Vrátit" - vrácená položka musí sednout tam,
     odkud zmizela, ne na konec seznamu. */
  it("vrácená položka sedí na svém původním místě", () => {
    const state = withTodos("a", "b", "c");
    const removed = sortedTodos(state.todos)[1];
    const without = deleteTodo(state, removed.id);

    expect(sortedTodos(restoreTodo(without, removed).todos).map((t) => t.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("vrácení drží i odškrtnutí", () => {
    const base = withTodos("a", "hotová");
    const state = toggleTodo(base, base.todos[1].id, NOON);
    const removed = state.todos.find((t) => t.text === "hotová")!;
    const back = restoreTodo(deleteTodo(state, removed.id), removed);

    expect(back.todos.find((t) => t.text === "hotová")!.doneAt).toBe(removed.doneAt);
  });

  it("dvojí vrácení položku nezdvojí", () => {
    const state = withTodos("a", "b");
    const removed = state.todos[0];
    const once = restoreTodo(deleteTodo(state, removed.id), removed);

    expect(restoreTodo(once, removed)).toBe(once);
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

describe("termín", () => {
  /** Hodina v lokálním čase, ať test sedí v každém pásmu. */
  function localTime(at: Date): string {
    return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  }

  it("nová položka termín nemá", () => {
    const state = withTodos("úkol");

    expect(state.todos[0].dueDate).toBeNull();
    expect(state.todos[0].dueTime).toBeNull();
  });

  it("nastaví den i hodinu a umí je zase sundat", () => {
    const state = withTodos("zavolat");
    const id = state.todos[0].id;

    const withDue = setTodoDue(state, id, "2026-08-20", "9:05");
    expect(withDue.todos[0].dueDate).toBe("2026-08-20");
    // Vedoucí nula se doplní, ať se termíny dají porovnávat i jako text.
    expect(withDue.todos[0].dueTime).toBe("09:05");

    const cleared = setTodoDue(withDue, id, null);
    expect(cleared.todos[0].dueDate).toBeNull();
    expect(cleared.todos[0].dueTime).toBeNull();
  });

  /* "Ve tři" bez dne není termín, ale přání - a podstrčit k tomu tiše dnešek
     by položce nastavilo den, o kterém uživatel nic neřekl. */
  it("hodina bez dne se zahodí", () => {
    const state = withTodos("zavolat");
    const out = setTodoDue(state, state.todos[0].id, null, "14:00");

    expect(out.todos[0].dueDate).toBeNull();
    expect(out.todos[0].dueTime).toBeNull();
  });

  it("nesmyslná hodina se zahodí, den zůstane", () => {
    const state = withTodos("zavolat");
    const out = setTodoDue(state, state.todos[0].id, "2026-08-20", "25:99");

    expect(out.todos[0].dueDate).toBe("2026-08-20");
    expect(out.todos[0].dueTime).toBeNull();
  });

  it("stejný termín vrací tentýž stav", () => {
    const state = setTodoDue(withTodos("a"), withTodos("a").todos[0].id, "2026-08-20");
    expect(setTodoDue(state, state.todos[0].id, state.todos[0].dueDate)).toBe(state);
  });

  it("popisek je krátký a lidský", () => {
    const state = withTodos("a");
    const today = toISODate(NOON);
    const tomorrow = toISODate(new Date(NOON.getTime() + 86_400_000));

    const dnes = setTodoDue(state, state.todos[0].id, today, "14:30").todos[0];
    expect(formatTodoDue(dnes, NOON)).toBe("dnes 14:30");

    const zitra = setTodoDue(state, state.todos[0].id, tomorrow).todos[0];
    expect(formatTodoDue(zitra, NOON)).toBe("zítra");

    // Vzdálený termín už den v týdnu neřekne, ten se nedá představit.
    const daleko = setTodoDue(state, state.todos[0].id, "2026-12-24").todos[0];
    expect(formatTodoDue(daleko, NOON)).toBe("24. 12.");
    expect(formatTodoDue(state.todos[0], NOON)).toBe("");
  });

  it("propadlý termín se pozná, odškrtnutá položka po termínu nikdy není", () => {
    const state = withTodos("zavolat");
    const past = new Date(NOON.getTime() - 90 * 60 * 1000);
    const overdue = setTodoDue(state, state.todos[0].id, toISODate(past), localTime(past));

    expect(isTodoOverdue(overdue.todos[0], NOON)).toBe(true);
    expect(isTodoOverdue(toggleTodo(overdue, state.todos[0].id, NOON).todos[0], NOON)).toBe(false);
  });

  /* Den bez hodiny propadá až o půlnoci - jinak by položka zadaná "na dnešek"
     byla po termínu hned, jak se na ni ráno člověk podívá. */
  it("den bez hodiny platí do půlnoci", () => {
    const state = withTodos("nákup");
    const today = setTodoDue(state, state.todos[0].id, toISODate(NOON));

    expect(isTodoOverdue(today.todos[0], NOON)).toBe(false);
  });

  it("termín do hodiny je 'brzy', vzdálenější ne", () => {
    const state = withTodos("schůzka");
    const soon = new Date(NOON.getTime() + 30 * 60 * 1000);
    const later = new Date(NOON.getTime() + 5 * 60 * 60 * 1000);

    expect(
      isTodoDueSoon(setTodoDue(state, state.todos[0].id, toISODate(soon), localTime(soon)).todos[0], NOON),
    ).toBe(true);
    expect(
      isTodoDueSoon(setTodoDue(state, state.todos[0].id, toISODate(later), localTime(later)).todos[0], NOON),
    ).toBe(false);
  });

  it("nabídky termínů míří dopředu a mají den", () => {
    for (const s of dueSuggestions(NOON)) {
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe("nastavitelné mizení", () => {
  const HALF_HOUR = 30 * 60 * 1000;

  it("kratší doba maže dřív", () => {
    const base = withTodos("hotová");
    const state = toggleTodo(base, base.todos[0].id, NOON);

    expect(purgeTodos(state, hoursLater(1), HALF_HOUR).todos).toHaveLength(0);
    // Se šesti hodinami by tam ta samá položka pořád ještě byla.
    expect(purgeTodos(state, hoursLater(1), TODO_TTL_MS).todos).toHaveLength(1);
  });

  /* Nula je dohodnutá řeč pro vypnuté mizení. Musí projít všemi funkcemi
     naráz - kdyby ji jedna přehlédla, položka by beze stopy zmizela. */
  it("nula znamená, že se nemaže nic", () => {
    const base = withTodos("hotová");
    const state = toggleTodo(base, base.todos[0].id, NOON);
    const todo = state.todos[0];

    expect(purgeTodos(state, hoursLater(1000), 0)).toBe(state);
    expect(isTodoExpired(todo, hoursLater(1000), 0)).toBe(false);
    expect(todoRemaining(todo, hoursLater(1000), 0)).toBe(1);
    expect(todoRemainingMs(todo, hoursLater(1000), 0)).toBeNull();
  });

  it("zbývající čas se počítá z nastavené doby", () => {
    const base = withTodos("hotová");
    const state = toggleTodo(base, base.todos[0].id, NOON);

    expect(todoRemainingMs(state.todos[0], NOON, HALF_HOUR)).toBe(HALF_HOUR);
    expect(todoRemainingMs(state.todos[0], hoursLater(0.25), HALF_HOUR)).toBe(HALF_HOUR / 2);
    // Pod nulu se to nepropadne, i když se appka týden neotevřela.
    expect(todoRemainingMs(state.todos[0], hoursLater(100), HALF_HOUR)).toBe(0);
    // Otevřená položka neodměřuje nic.
    expect(todoRemainingMs(base.todos[0], NOON, HALF_HOUR)).toBeNull();
  });

  it("popisek zbývajícího času nedrobí hodiny na minuty", () => {
    expect(formatRemaining(5 * 60 * 60 * 1000 + 12 * 60 * 1000)).toBe("za 5 h");
    expect(formatRemaining(12 * 60 * 1000)).toBe("za 12 min");
    expect(formatRemaining(20 * 1000)).toBe("za chvíli");
  });

  it("popisek doby v nastavení mluví česky", () => {
    expect(formatDuration(30 * 60 * 1000)).toBe("30 min");
    expect(formatDuration(6 * 60 * 60 * 1000)).toBe("6 h");
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe("1 den");
  });
});
