import { describe, expect, it } from "vitest";
import { createProject, createTask, setTaskCurrent } from "./project-actions";
import { addTodo, setTodoDue, toggleTodo } from "./todos";
import {
  addBlock,
  blocksOfDay,
  daySummary,
  blockTitle,
  DAY_MINUTES,
  deleteBlock,
  formatLength,
  formatMinutes,
  formatSpan,
  layoutDay,
  moveBlock,
  moveBlockToDay,
  nextFreeSlot,
  parseMinutes,
  pinsOfDay,
  plannedMinutes,
  resizeBlock,
  restoreBlock,
  toggleBlockDone,
  unplannedTasks,
  unplannedTodos,
  updateBlock,
  weekDays,
  weekStart,
} from "./timeblocks";
import { EMPTY_STATE, type MicroWinsState, type TimeBlock } from "./types";

const DAY = "2026-08-13";
const OTHER_DAY = "2026-08-14";
const NOON = new Date("2026-08-13T12:00:00.000Z");

/** Bloky dne v pořadí, jak jdou po sobě - `[začátek, délka]` v minutách. */
function withBlocks(...spans: [number, number][]): MicroWinsState {
  return spans.reduce<MicroWinsState>(
    (state, [start, duration]) =>
      addBlock(state, { date: DAY, start, duration, title: `${start}` }, NOON).state,
    EMPTY_STATE,
  );
}

function spans(state: MicroWinsState): [number, number][] {
  return blocksOfDay(state, DAY).map((b) => [b.start, b.duration]);
}

describe("zakládání a posouvání", () => {
  /** Zarovnává se na **nejbližší** čtvrthodinu, a to začátek i délka. */
  it("blok se zarovná na čtvrthodinu", () => {
    expect(spans(addBlock(EMPTY_STATE, { date: DAY, start: 547, duration: 37 }, NOON).state)).toEqual(
      [[540, 30]],
    );
    expect(spans(addBlock(EMPTY_STATE, { date: DAY, start: 553, duration: 38 }, NOON).state)).toEqual(
      [[555, 45]],
    );
  });

  it("blok se nepustí přes půlnoc", () => {
    const late = addBlock(EMPTY_STATE, { date: DAY, start: 23 * 60 + 45, duration: 120 }, NOON);

    expect(late.block.start + late.block.duration).toBeLessThanOrEqual(DAY_MINUTES);
  });

  it("posun drží délku, tažení za hranu drží začátek", () => {
    const state = withBlocks([540, 60]);
    const id = blocksOfDay(state, DAY)[0].id;

    expect(spans(moveBlock(state, id, 605))).toEqual([[600, 60]]);
    expect(spans(resizeBlock(state, id, 97))).toEqual([[540, 90]]);
  });

  /* Prst při tahu snadno přejede až za konec dne. Blok se má zastavit
     o půlnoci, ne zmizet a ne se zabalit do dalšího dne. */
  it("posun ani natažení nepřeteče půlnoc", () => {
    const state = withBlocks([1380, 60]);
    const id = blocksOfDay(state, DAY)[0].id;

    expect(spans(moveBlock(state, id, 1500))).toEqual([[1380, 60]]);
    expect(spans(resizeBlock(state, id, 600))).toEqual([[1380, 60]]);
  });

  it("nejkratší blok je čtvrthodina", () => {
    const state = withBlocks([540, 60]);
    const id = blocksOfDay(state, DAY)[0].id;

    expect(spans(resizeBlock(state, id, 1))).toEqual([[540, 15]]);
  });

  it("úprava zvládne čas, délku, text i den naráz", () => {
    const state = withBlocks([540, 60]);
    const id = blocksOfDay(state, DAY)[0].id;
    const out = updateBlock(state, id, {
      title: "  Hluboká práce  ",
      start: 600,
      duration: 90,
      date: OTHER_DAY,
    });

    expect(blocksOfDay(out, DAY)).toHaveLength(0);
    expect(blocksOfDay(out, OTHER_DAY)[0]).toMatchObject({
      start: 600,
      duration: 90,
      title: "Hluboká práce",
    });
  });

  it("přesun na jiný den drží čas", () => {
    const state = withBlocks([540, 60]);
    const id = blocksOfDay(state, DAY)[0].id;
    const out = moveBlockToDay(state, id, OTHER_DAY);

    expect(blocksOfDay(out, OTHER_DAY)[0].start).toBe(540);
  });

  it("beze změny vrací tentýž stav", () => {
    const state = withBlocks([540, 60]);
    const id = blocksOfDay(state, DAY)[0].id;

    expect(moveBlock(state, id, 540)).toBe(state);
    expect(resizeBlock(state, id, 60)).toBe(state);
    expect(moveBlock(state, "neexistuje", 600)).toBe(state);
    expect(deleteBlock(state, "neexistuje")).toBe(state);
  });

  it("smazaný blok se dá vrátit, a to jen jednou", () => {
    const state = withBlocks([540, 60]);
    const block = blocksOfDay(state, DAY)[0];
    const back = restoreBlock(deleteBlock(state, block.id), block);

    expect(spans(back)).toEqual([[540, 60]]);
    expect(restoreBlock(back, block)).toBe(back);
  });

  it("den vidí jen svoje bloky", () => {
    const state = addBlock(withBlocks([540, 60]), { date: OTHER_DAY, start: 60, duration: 30 }, NOON)
      .state;

    expect(blocksOfDay(state, DAY)).toHaveLength(1);
    expect(blocksOfDay(state, OTHER_DAY)).toHaveLength(1);
  });
});

describe("překryvy", () => {
  it("bloky za sebou drží jeden sloupec", () => {
    const state = withBlocks([540, 60], [600, 60]);

    expect(layoutDay(blocksOfDay(state, DAY)).map((l) => [l.column, l.columns])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  /* Dvě věci naráz se nezakazují ani neodstrkávají - jen se postaví vedle sebe,
     ať je na první pohled vidět, že si to člověk naplánoval přes sebe. */
  it("dva bloky přes sebe se rozdělí na dva sloupce", () => {
    const state = withBlocks([540, 60], [570, 60]);
    const layout = layoutDay(blocksOfDay(state, DAY));

    expect(layout.map((l) => l.column)).toEqual([0, 1]);
    expect(layout.every((l) => l.columns === 2)).toBe(true);
  });

  it("šířku určuje celý shluk, ne jen dvojice", () => {
    // 9:00-11:00, 9:15-10:15 a 9:30-10:30 leží přes sebe všechny tři naráz.
    const state = withBlocks([540, 120], [555, 60], [570, 60]);
    const layout = layoutDay(blocksOfDay(state, DAY));

    expect(layout.map((l) => l.column)).toEqual([0, 1, 2]);
    expect(layout.every((l) => l.columns === 3)).toBe(true);
  });

  it("uvolněný sloupec se použije znovu", () => {
    // 9:00-10:00 a 9:30-10:30 se překrývají, 10:00-11:00 sedne zpátky do prvního.
    const state = withBlocks([540, 60], [570, 60], [600, 60]);
    const layout = layoutDay(blocksOfDay(state, DAY));

    expect(layout.map((l) => l.column)).toEqual([0, 1, 0]);
  });

  it("zabraný čas se počítá jednou, i když se bloky překrývají", () => {
    expect(plannedMinutes(blocksOfDay(withBlocks([540, 60], [570, 60]), DAY))).toBe(90);
    expect(plannedMinutes(blocksOfDay(withBlocks([540, 60], [600, 30]), DAY))).toBe(90);
  });
});

describe("hledání volna", () => {
  it("prázdný den bere rovnou první možný čas", () => {
    expect(nextFreeSlot([], 540, 30)).toBe(540);
  });

  it("obsazený čas přeskočí až za blok", () => {
    const blocks = blocksOfDay(withBlocks([540, 60]), DAY);

    expect(nextFreeSlot(blocks, 540, 30)).toBe(600);
    expect(nextFreeSlot(blocks, 555, 30)).toBe(600);
  });

  it("do mezery se blok vejde, když je dost velká", () => {
    const blocks = blocksOfDay(withBlocks([540, 60], [660, 60]), DAY);

    expect(nextFreeSlot(blocks, 540, 30)).toBe(600);
    // Hodinová mezera na půlhodinu stačí, na dvě hodiny ne.
    expect(nextFreeSlot(blocks, 540, 120)).toBe(720);
  });

  it("čas se zarovná na čtvrthodinu", () => {
    expect(nextFreeSlot([], 547, 30)).toBe(540);
  });

  /* Když do konce dne nic nezbylo, ať blok radši vznikne přes jiný, než aby
     ťuknutí neudělalo nic - to vypadá jako rozbitá appka. */
  it("plný den vrátí aspoň výchozí čas", () => {
    const blocks = blocksOfDay(withBlocks([0, DAY_MINUTES]), DAY);

    expect(nextFreeSlot(blocks, 600, 30)).toBe(600);
  });
});

describe("odškrtnutí", () => {
  function withTodoBlock() {
    const added = addTodo(EMPTY_STATE, "zavolat doktorovi", NOON);
    const todo = added.todo!;
    const res = addBlock(
      added.state,
      { date: DAY, start: 540, duration: 30, title: todo.text, todoId: todo.id },
      NOON,
    );
    return { state: res.state, block: res.block, todoId: todo.id };
  }

  it("blok z položky ToDo odškrtne i tu položku", () => {
    const { state, block, todoId } = withTodoBlock();
    const done = toggleBlockDone(state, block.id, NOON);

    expect(done.timeBlocks[0].doneAt).not.toBeNull();
    expect(done.todos.find((t) => t.id === todoId)!.doneAt).not.toBeNull();
  });

  it("vrácení bloku vrátí i položku", () => {
    const { state, block, todoId } = withTodoBlock();
    const back = toggleBlockDone(toggleBlockDone(state, block.id, NOON), block.id, NOON);

    expect(back.timeBlocks[0].doneAt).toBeNull();
    expect(back.todos.find((t) => t.id === todoId)!.doneAt).toBeNull();
  });

  /* Položka už odškrtnutá odjinud se nesmí odškrtnutím bloku přepnout zpátky
     na otevřenou - `toggleTodo` přepíná, tady se srovnává stav. */
  it("už odškrtnutou položku odškrtnutí bloku nevrátí zpět", () => {
    const { state, block, todoId } = withTodoBlock();
    const done = toggleBlockDone(toggleTodo(state, todoId, NOON), block.id, NOON);

    expect(done.todos.find((t) => t.id === todoId)!.doneAt).not.toBeNull();
  });

  it("blok z úkolu projektu do úkolu nesahá", () => {
    const project = createProject(EMPTY_STATE, { name: "10K kliků" }, DAY);
    const task = createTask(project.state, project.project.id, { name: "kliky", target: 100 }, DAY);
    const res = addBlock(
      task.state,
      { date: DAY, start: 540, duration: 60, title: "kliky", taskId: task.task.id },
      NOON,
    );
    const done = toggleBlockDone(res.state, res.block.id, NOON);

    expect(done.timeBlocks[0].doneAt).not.toBeNull();
    expect(done.tasks[0].current).toBe(0);
  });
});

describe("popisky", () => {
  it("čas a délka se píšou lidsky", () => {
    expect(formatMinutes(540)).toBe("9:00");
    expect(formatMinutes(1385)).toBe("23:05");
    expect(formatLength(45)).toBe("45 min");
    expect(formatLength(60)).toBe("1 h");
    expect(formatLength(90)).toBe("1 h 30 min");
  });

  it("rozsah bloku je jeden popisek", () => {
    const block = blocksOfDay(withBlocks([540, 90]), DAY)[0];

    expect(formatSpan(block)).toBe("9:00-10:30");
  });

  it("z pole se přečte jen platný čas", () => {
    expect(parseMinutes("9:30")).toBe(570);
    expect(parseMinutes("09:30")).toBe(570);
    expect(parseMinutes("24:00")).toBeNull();
    expect(parseMinutes("nesmysl")).toBeNull();
  });

  /* Přejmenovaný úkol se má propsat i do plánu, proto se text čte z odkazu.
     Smazaná položka ale plán rozbít nesmí - zbyde text, se kterým blok vznikl. */
  it("popisek bere přednostně z toho, na co blok ukazuje", () => {
    const added = addTodo(EMPTY_STATE, "původní text", NOON);
    const todo = added.todo!;
    const res = addBlock(
      added.state,
      { date: DAY, start: 540, duration: 30, title: todo.text, todoId: todo.id },
      NOON,
    );
    const renamed: MicroWinsState = {
      ...res.state,
      todos: res.state.todos.map((t) => ({ ...t, text: "nový text" })),
    };

    expect(blockTitle(renamed, res.block)).toBe("nový text");
    expect(blockTitle({ ...renamed, todos: [] }, res.block)).toBe("původní text");

    const bare: TimeBlock = { ...res.block, todoId: null, title: "" };
    expect(blockTitle(renamed, bare)).toBe("Blok");
  });
});

describe("co ještě není v plánu", () => {
  it("položka s blokem z pásu zmizí, jinde zůstane", () => {
    const added = addTodo(EMPTY_STATE, "zavolat", NOON);
    const todo = added.todo!;
    const state = addBlock(
      added.state,
      { date: DAY, start: 540, duration: 30, title: todo.text, todoId: todo.id },
      NOON,
    ).state;

    expect(unplannedTodos(state, DAY)).toHaveLength(0);
    expect(unplannedTodos(state, OTHER_DAY)).toHaveLength(1);
  });

  it("odškrtnutá položka se do plánu nenabízí", () => {
    const added = addTodo(EMPTY_STATE, "hotovo", NOON);

    expect(unplannedTodos(toggleTodo(added.state, added.todo!.id, NOON), DAY)).toHaveLength(0);
  });

  it("hotový úkol ani úkol z archivu se nenabízí", () => {
    const project = createProject(EMPTY_STATE, { name: "10K kliků" }, DAY);
    const open = createTask(project.state, project.project.id, { name: "kliky", target: 100 }, DAY);
    const closed = createTask(open.state, project.project.id, { name: "hotový", target: 1 }, DAY);
    const state = setTaskCurrent(closed.state, closed.task.id, 1, DAY);

    expect(unplannedTasks(state, DAY).map((t) => t.name)).toEqual(["kliky"]);

    const archived: MicroWinsState = {
      ...state,
      projects: state.projects.map((p) => ({ ...p, archivedAt: "2026-08-01T10:00:00.000Z" })),
    };
    expect(unplannedTasks(archived, DAY)).toHaveLength(0);
  });

  it("napřed to, co má termín dřív", () => {
    const project = createProject(EMPTY_STATE, { name: "P" }, DAY);
    const bez = createTask(project.state, project.project.id, { name: "bez termínu", target: 5 }, DAY);
    const pozdeji = createTask(
      bez.state,
      project.project.id,
      { name: "později", target: 5, dueDate: "2026-09-01" },
      DAY,
    );
    const dnes = createTask(
      pozdeji.state,
      project.project.id,
      { name: "dnes", target: 5, dueDate: DAY },
      DAY,
    );

    expect(unplannedTasks(dnes.state, DAY).map((t) => t.name)).toEqual([
      "dnes",
      "později",
      "bez termínu",
    ]);
  });
});

describe("propojení s termínem v ToDo", () => {
  function withTodoBlock(start = 540) {
    const added = addTodo(EMPTY_STATE, "zavolat doktorovi", NOON);
    const todo = added.todo!;
    const res = addBlock(
      added.state,
      { date: DAY, start, duration: 30, title: todo.text, todoId: todo.id },
      NOON,
    );
    return { state: res.state, block: res.block, todoId: todo.id };
  }

  const dueOf = (state: MicroWinsState, id: string) => {
    const todo = state.todos.find((t) => t.id === id)!;
    return `${todo.dueDate} ${todo.dueTime}`;
  };

  /* Blok a termín jsou jedna informace ze dvou stran. Dvě čísla, která si
     můžou odporovat, by byla horší než žádné. */
  it("naplánováním položky vznikne i její termín", () => {
    const { state, todoId } = withTodoBlock(540);

    expect(dueOf(state, todoId)).toBe(`${DAY} 09:00`);
  });

  it("posun bloku posune i termín", () => {
    const { state, block, todoId } = withTodoBlock(540);

    expect(dueOf(moveBlock(state, block.id, 615), todoId)).toBe(`${DAY} 10:15`);
  });

  it("přesun na jiný den přepíše i den termínu", () => {
    const { state, block, todoId } = withTodoBlock(540);

    expect(dueOf(moveBlockToDay(state, block.id, OTHER_DAY), todoId)).toBe(`${OTHER_DAY} 09:00`);
  });

  it("natažení bloku termín nehýbe - začátek zůstal", () => {
    const { state, block, todoId } = withTodoBlock(540);

    expect(dueOf(resizeBlock(state, block.id, 120), todoId)).toBe(`${DAY} 09:00`);
  });

  it("blok bez položky do ToDo nesahá", () => {
    const added = addTodo(EMPTY_STATE, "bez bloku", NOON);
    const res = addBlock(added.state, { date: DAY, start: 540, title: "ruční" }, NOON);

    expect(res.state.todos[0].dueDate).toBeNull();
  });

  it("termín s hodinou se v plánu ukáže jako stopa", () => {
    const added = addTodo(EMPTY_STATE, "zavolat", NOON);
    const state = setTodoDue(added.state, added.todo!.id, DAY, "14:30");
    const [pin] = pinsOfDay(state, DAY);

    expect(pin.start).toBe(870);
    expect(pin.todo.text).toBe("zavolat");
    expect(pinsOfDay(state, OTHER_DAY)).toHaveLength(0);
  });

  it("den bez hodiny stopu nedělá - není na čem stát", () => {
    const added = addTodo(EMPTY_STATE, "někdy dnes", NOON);
    const state = setTodoDue(added.state, added.todo!.id, DAY, null);

    expect(pinsOfDay(state, DAY)).toHaveLength(0);
  });

  it("odškrtnutá položka ani položka s blokem stopu nedělá", () => {
    const added = addTodo(EMPTY_STATE, "zavolat", NOON);
    const id = added.todo!.id;
    const withDue = setTodoDue(added.state, id, DAY, "14:30");

    expect(pinsOfDay(toggleTodo(withDue, id, NOON), DAY)).toHaveLength(0);

    const planned = addBlock(
      withDue,
      { date: DAY, start: 870, duration: 30, title: "zavolat", todoId: id },
      NOON,
    ).state;
    expect(pinsOfDay(planned, DAY)).toHaveLength(0);
  });
});

describe("týden", () => {
  it("začíná v pondělí a má sedm dnů", () => {
    // 13. 8. 2026 je čtvrtek.
    expect(weekStart("2026-08-13")).toBe("2026-08-10");
    expect(weekDays("2026-08-13")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("neděle patří k týdnu, který začal v pondělí", () => {
    expect(weekStart("2026-08-16")).toBe("2026-08-10");
  });

  it("souhrn dne počítá bloky, minuty i stopy", () => {
    const added = addTodo(withBlocks([540, 60], [660, 30]), "zavolat", NOON);
    const state = setTodoDue(added.state, added.todo!.id, DAY, "14:30");

    expect(daySummary(state, DAY)).toEqual({ blocks: 2, minutes: 90, done: 0, pins: 1 });
  });
});
