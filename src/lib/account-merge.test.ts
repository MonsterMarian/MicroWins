import { describe, expect, it } from "vitest";
import { mergeIntoAccount, stampKey } from "./account-merge";
import { addCategory, addEntry, addMetric } from "./actions";
import { createProject, createTask } from "./project-actions";
import { setBrainDump, setPriority } from "./timebox";
import { addTodo } from "./todos";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const TODAY = "2026-09-30";

/** Data jednoho zařízení: strom s winem a zápisem, projekt s úkolem, ToDo. */
function device(label: string): MicroWinsState {
  const cat = addCategory(EMPTY_STATE, null, `${label} složka`);
  const metric = addMetric(cat.state, cat.node.id, { name: `X ${label} za den` });
  const entry = addEntry(metric.state, { metricId: metric.node.id, value: 3 }, TODAY).state;
  const prj = createProject(entry, { name: `${label} projekt` }, TODAY);
  const task = createTask(prj.state, prj.project.id, { name: `${label} úkol`, target: 10 }, TODAY);
  return addTodo(task.state, `${label} položka`).state;
}

describe("nový účet ze zařízení s daty", () => {
  /* Nejčastější případ: appku používám měsíce bez účtu, teď si ho založím.
     Účet je prázdný a všechno z telefonu v něm musí být - se stejnými id,
     jinak by synchronizace nevěděla, že jde o tytéž věci. */
  it("převezme úplně všechno a id nechá být", () => {
    const phone = device("Telefon");
    const res = mergeIntoAccount(EMPTY_STATE, phone);

    expect(res.state.nodes).toEqual(phone.nodes);
    expect(res.state.entries).toEqual(phone.entries);
    expect(res.state.microwins).toEqual(phone.microwins);
    expect(res.state.projects).toEqual(phone.projects);
    expect(res.state.tasks).toEqual(phone.tasks);
    expect(res.state.todos).toEqual(phone.todos);
    expect(res.state.snapshots).toEqual(phone.snapshots);
    expect(res.conflicts).toEqual([]);
    expect(res.added.projects).toBe(1);
  });
});

describe("přihlášení do účtu, který už data má", () => {
  const account = device("Účet");
  const tablet = device("Tablet");

  it("data z obou stran jsou vedle sebe, nic nezmizí", () => {
    const { state } = mergeIntoAccount(account, tablet);

    expect(state.projects.map((p) => p.name)).toEqual(["Účet projekt", "Tablet projekt"]);
    expect(state.nodes).toHaveLength(4);
    expect(state.entries).toHaveLength(2);
    expect(state.microwins).toHaveLength(2);
    expect(state.todos.map((t) => t.text)).toEqual(["Účet položka", "Tablet položka"]);
  });

  it("projekty a ToDo ze zařízení se řadí za ty z účtu", () => {
    const { state } = mergeIntoAccount(account, tablet);

    expect(state.projects.map((p) => p.order)).toEqual([0, 1]);
    expect(state.todos.map((t) => t.order)).toEqual([0, 1]);
  });

  /* Tablet dostal data z telefonu obnovou zálohy - id jsou stejná. Co se od
     té doby nezměnilo, nesmí se zdvojit. */
  it("stejné záznamy na obou stranách zůstanou jednou", () => {
    const res = mergeIntoAccount(account, account);

    expect(res.state).toEqual(account);
    expect(res.conflicts).toEqual([]);
    expect(res.added).toEqual({});
  });

  it("druhé převzetí téhož nic nepřidá ani nezmění", () => {
    const once = mergeIntoAccount(account, tablet).state;
    const twice = mergeIntoAccount(once, tablet);

    expect(twice.state).toEqual(once);
    expect(twice.conflicts).toEqual([]);
  });
});

describe("konflikt - stejné id, jiný obsah", () => {
  const account = device("Účet");
  const task = account.tasks[0];
  const edited: MicroWinsState = {
    ...account,
    tasks: account.tasks.map((t) => (t.id === task.id ? { ...t, current: 7 } : t)),
  };

  it("bez časů změn vyhraje účet a konflikt se nahlásí", () => {
    const res = mergeIntoAccount(account, edited);

    expect(res.state.tasks[0].current).toBe(account.tasks[0].current);
    expect(res.conflicts).toEqual([{ kind: "tasks", key: task.id, kept: "account" }]);
  });

  it("s časy změn vyhraje novější strana", () => {
    const key = stampKey("tasks", task.id);
    const newerLocal = mergeIntoAccount(account, edited, {
      account: new Map([[key, "2026-09-01T10:00:00.000Z"]]),
      local: new Map([[key, "2026-09-20T10:00:00.000Z"]]),
    });
    const newerAccount = mergeIntoAccount(account, edited, {
      account: new Map([[key, "2026-09-25T10:00:00.000Z"]]),
      local: new Map([[key, "2026-09-20T10:00:00.000Z"]]),
    });

    expect(newerLocal.state.tasks[0].current).toBe(7);
    expect(newerLocal.conflicts[0].kept).toBe("local");
    expect(newerAccount.state.tasks[0].current).toBe(account.tasks[0].current);
  });

  it("jiné pořadí projektu konflikt není - pořadí se bere z účtu", () => {
    const moved: MicroWinsState = {
      ...account,
      projects: account.projects.map((p) => ({ ...p, order: 5 })),
    };
    const res = mergeIntoAccount(account, moved);

    expect(res.conflicts).toEqual([]);
    expect(res.state.projects[0].order).toBe(0);
  });
});

describe("list time boxu k témuž dni ze dvou zařízení", () => {
  const base = setBrainDump(setPriority(EMPTY_STATE, TODAY, 0, "Zavolat bance"), TODAY, "nápad z účtu");

  it("prázdná priorita se doplní, obsazená zůstane a ta druhá jde do brain dumpu", () => {
    const local = setBrainDump(
      setPriority(setPriority(EMPTY_STATE, TODAY, 0, "Dopsat nabídku"), TODAY, 1, "Běhat"),
      TODAY,
      "nápad z telefonu",
    );
    const res = mergeIntoAccount(base, local);
    const sheet = res.state.daySheets[0];

    expect(sheet.priorities.map((p) => p.text)).toEqual(["Zavolat bance", "Běhat", ""]);
    expect(sheet.brainDump).toBe("nápad z účtu\n\nnápad z telefonu\n\n• Dopsat nabídku");
    expect(res.conflicts).toEqual([]);
  });

  it("opakované převzetí nic nepřipisuje znovu", () => {
    const local = setBrainDump(setPriority(EMPTY_STATE, TODAY, 0, "Dopsat nabídku"), TODAY, "z telefonu");
    const once = mergeIntoAccount(base, local).state;
    const twice = mergeIntoAccount(once, local).state;

    expect(twice.daySheets).toEqual(once.daySheets);
  });

  it("stejná priorita odškrtnutá na jedné straně zůstane odškrtnutá", () => {
    const local: MicroWinsState = {
      ...base,
      daySheets: base.daySheets.map((s) => ({
        ...s,
        priorities: s.priorities.map((p, i) => (i === 0 ? { ...p, done: true } : p)),
      })),
    };
    const res = mergeIntoAccount(base, local);

    expect(res.state.daySheets[0].priorities[0].done).toBe(true);
  });

  /* Brain dump má strop; oříznutý spoj by potichu ztratil konec. Radši
     zůstane list z účtu a den se nahlásí - verze z telefonu je v záloze. */
  it("když by spojený brain dump přetekl, zůstane účet a den se nahlásí", () => {
    const long = setBrainDump(EMPTY_STATE, TODAY, "x".repeat(3990));
    const res = mergeIntoAccount(base, long);

    expect(res.state.daySheets[0].brainDump).toBe("nápad z účtu");
    expect(res.conflicts).toEqual([{ kind: "daySheets", key: TODAY, kept: "account" }]);
  });
});

describe("microwin ze dvou zařízení", () => {
  it("na win a den zůstane jen jeden - ten vyšší", () => {
    const account = device("Účet");
    const win = account.microwins[0];
    const local: MicroWinsState = {
      ...account,
      microwins: [{ ...win, id: "w_tablet", value: win.value + 2 }],
    };
    const res = mergeIntoAccount(account, local);

    expect(res.state.microwins).toHaveLength(1);
    expect(res.state.microwins[0].id).toBe("w_tablet");
  });
});
