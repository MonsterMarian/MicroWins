import { beforeEach, describe, expect, it } from "vitest";
import { addCategory, reorderNodes } from "./actions";
import { createProject, createTask, updateTask } from "./project-actions";
import { recordId } from "./sync";
import {
  SyncEngine,
  type OutgoingRow,
  type RemoteRow,
  type SyncMeta,
  type SyncProgress,
  type SyncTransport,
  PUSH_BATCH,
} from "./sync-engine";
import { addTodo, deleteTodo, renameTodo } from "./todos";
import { EMPTY_STATE, type MicroWinsState } from "./types";

const TODAY = "2026-09-30";

/** Jedny hodiny pro všechny - změny i příchody na server jdou po sobě. */
let clock = 0;
const tick = () => new Date(Date.UTC(2026, 8, 30, 10, 0, 0) + ++clock * 1000);

/** Tabulka `records` v paměti se stejným pravidlem jako `push_records`. */
class FakeServer {
  rows = new Map<string, RemoteRow>();
  down = false;

  transport(): SyncTransport {
    return {
      pull: async (since) => {
        if (this.down) throw new TypeError("Failed to fetch");
        return [...this.rows.values()]
          .filter((r) => since === null || Date.parse(r.updated_at) > Date.parse(since))
          .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
      },
      push: async (rows: OutgoingRow[]) => {
        if (this.down) throw new TypeError("Failed to fetch");
        const at = tick().toISOString();
        for (const r of rows) {
          const id = recordId(r.kind, r.key);
          const current = this.rows.get(id);
          // Starší změna novější nepřepíše - stejně jako `where` v SQL.
          if (current && Date.parse(current.changed_at) >= Date.parse(r.changed_at)) continue;
          this.rows.set(id, { ...r, updated_at: at });
        }
      },
    };
  }

  live(kind: string): unknown[] {
    return [...this.rows.values()].filter((r) => r.kind === kind && r.data !== null).map((r) => r.data);
  }
}

/** Jedno zařízení: stav appky, metadata synchronizace a motor nad nimi. */
class Device {
  state: MicroWinsState;
  meta: SyncMeta = { owner: null, cursor: null, outbox: {} };
  engine: SyncEngine;
  progress: (SyncProgress | null)[] = [];

  constructor(server: FakeServer, state: MicroWinsState = EMPTY_STATE) {
    this.state = state;
    this.engine = new SyncEngine({
      transport: server.transport(),
      loadMeta: () => this.meta,
      saveMeta: (m) => {
        this.meta = m;
      },
      getState: () => this.state,
      replaceState: (s) => {
        this.state = s;
      },
      now: tick,
      onProgress: (p) => {
        this.progress.push(p);
      },
    });
  }

  /** Jako `commit` ve StoreProvideru: změna jde do deníku a do stavu. */
  change(next: MicroWinsState): void {
    this.engine.journal(this.state, next);
    this.state = next;
  }

  async signIn(userId: string): Promise<void> {
    const plan = await this.engine.planAdoption(userId);
    if (plan) await this.engine.adopt(plan);
  }
}

function withProject(name: string): MicroWinsState {
  const p = createProject(EMPTY_STATE, { name }, TODAY);
  const t = createTask(p.state, p.project.id, { name: `${name} - úkol`, target: 10 }, TODAY);
  return addTodo(t.state, `${name} - položka`).state;
}

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
});

describe("převzetí dat po přihlášení", () => {
  /* Telefon, na kterém appka jede měsíce bez účtu, si založí účet. */
  it("data z telefonu se nahrají do nového účtu a v telefonu zůstanou", async () => {
    const phone = new Device(server, withProject("Telefon"));
    const before = phone.state;
    await phone.signIn("u1");

    expect(phone.meta.owner).toBe("u1");
    expect(phone.state).toEqual(before);
    expect(server.live("projects")).toEqual(before.projects);
    expect(server.live("todos")).toEqual(before.todos);
  });

  it("prázdné zařízení převezme účet bez ptaní", async () => {
    const phone = new Device(server, withProject("Telefon"));
    await phone.signIn("u1");
    const tablet = new Device(server);

    const plan = await tablet.engine.planAdoption("u1");
    expect(plan?.kind).toBe("fresh");
    await tablet.engine.adopt(plan!);

    expect(tablet.state.projects).toEqual(phone.state.projects);
    expect(tablet.state.tasks).toEqual(phone.state.tasks);
  });

  it("druhé zařízení s vlastními daty se s účtem spojí - nic se neztratí", async () => {
    const phone = new Device(server, withProject("Telefon"));
    await phone.signIn("u1");
    const tablet = new Device(server, withProject("Tablet"));

    const plan = await tablet.engine.planAdoption("u1");
    expect(plan?.kind).toBe("merge");
    await tablet.engine.adopt(plan!);
    await phone.engine.sync();

    for (const device of [phone, tablet]) {
      expect(device.state.projects.map((p) => p.name).sort()).toEqual(["Tablet", "Telefon"]);
      expect(device.state.todos).toHaveLength(2);
    }
  });

  it("data jiného účtu se samy neslučují", async () => {
    const phone = new Device(server, withProject("Telefon"));
    await phone.signIn("u1");

    const plan = await phone.engine.planAdoption("u2");
    expect(plan?.kind).toBe("foreign");
  });

  it("když spadne síť, telefon zůstane, jak byl, a převzetí jde zopakovat", async () => {
    const phone = new Device(server, withProject("Telefon"));
    const before = phone.state;
    const plan = await phone.engine.planAdoption("u1");
    server.down = true;

    await expect(phone.engine.adopt(plan!)).rejects.toThrow();
    expect(phone.state).toBe(before);
    expect(phone.meta.owner).toBeNull();

    server.down = false;
    await phone.signIn("u1");
    expect(phone.meta.owner).toBe("u1");
    expect(server.live("projects")).toHaveLength(1);
  });

  it("po převzetí už se nic nepřebírá", async () => {
    const phone = new Device(server, withProject("Telefon"));
    await phone.signIn("u1");
    expect(await phone.engine.planAdoption("u1")).toBeNull();
  });
});

describe("běžná synchronizace", () => {
  async function pair(): Promise<{ phone: Device; tablet: Device }> {
    const phone = new Device(server, withProject("Web"));
    await phone.signIn("u1");
    const tablet = new Device(server);
    await tablet.signIn("u1");
    return { phone, tablet };
  }

  it("změna z telefonu dorazí do tabletu", async () => {
    const { phone, tablet } = await pair();
    const todo = phone.state.todos[0];
    phone.change(renameTodo(phone.state, todo.id, "koupit čaj"));
    expect(phone.engine.pending()).toBe(1);

    await phone.engine.sync();
    expect(phone.engine.pending()).toBe(0);
    await tablet.engine.sync();

    expect(tablet.state.todos[0].text).toBe("koupit čaj");
  });

  it("stažená změna se neposílá zpátky", async () => {
    const { phone, tablet } = await pair();
    phone.change(addTodo(phone.state, "nová").state);
    await phone.engine.sync();
    await tablet.engine.sync();

    expect(tablet.engine.pending()).toBe(0);
  });

  it("smazání se propíše", async () => {
    const { phone, tablet } = await pair();
    phone.change(deleteTodo(phone.state, phone.state.todos[0].id));
    await phone.engine.sync();
    await tablet.engine.sync();

    expect(tablet.state.todos).toEqual([]);
  });

  /* Oba offline, každý mění něco jiného - po spojení mají obě změny oba. */
  it("různé změny ze dvou zařízení přežijí obě", async () => {
    const { phone, tablet } = await pair();
    phone.change(renameTodo(phone.state, phone.state.todos[0].id, "z telefonu"));
    const task = tablet.state.tasks[0];
    tablet.change(updateTask(tablet.state, task.id, { current: 7 }, TODAY));

    await phone.engine.sync();
    await tablet.engine.sync();
    await phone.engine.sync();

    for (const device of [phone, tablet]) {
      expect(device.state.todos[0].text).toBe("z telefonu");
      expect(device.state.tasks[0].current).toBe(7);
    }
  });

  it("stejná věc na obou - vyhraje novější změna", async () => {
    const { phone, tablet } = await pair();
    const id = phone.state.todos[0].id;
    phone.change(renameTodo(phone.state, id, "starší"));
    tablet.change(renameTodo(tablet.state, id, "novější"));

    await tablet.engine.sync();
    await phone.engine.sync();
    await tablet.engine.sync();

    expect(phone.state.todos[0].text).toBe("novější");
    expect(tablet.state.todos[0].text).toBe("novější");
  });

  it("pořadí ve stromu se přenese", async () => {
    const { phone, tablet } = await pair();
    const a = addCategory(phone.state, null, "A");
    const b = addCategory(a.state, null, "B");
    phone.change(b.state);
    phone.change(reorderNodes(phone.state, [b.node.id, a.node.id]));
    await phone.engine.sync();
    await tablet.engine.sync();

    expect(tablet.state.nodes.map((n) => n.name)).toEqual(["B", "A"]);
  });

  /* Po odhlášení deník běží dál - data pořád patří účtu. */
  it("změny bez spojení počkají a odejdou potom", async () => {
    const { phone, tablet } = await pair();
    server.down = true;
    phone.change(addTodo(phone.state, "bez signálu").state);
    await expect(phone.engine.sync()).rejects.toThrow();
    expect(phone.engine.pending()).toBe(1);

    server.down = false;
    await phone.engine.sync();
    await tablet.engine.sync();
    expect(tablet.state.todos.map((t) => t.text)).toContain("bez signálu");
  });

  it("data bez účtu se do deníku nepíšou", () => {
    const loose = new Device(server, withProject("Bez účtu"));
    loose.change(addTodo(loose.state, "x").state);
    expect(loose.engine.pending()).toBe(0);
  });
});

describe("průběh přenosu", () => {
  /* Pruh nahoře potřebuje vědět, kolik je hotovo z kolika - a kdy je konec. */
  it("nahrávání hlásí dávky z celku a nakonec konec", async () => {
    let state = withProject("Hodně");
    for (let i = 0; i < PUSH_BATCH + 20; i++) state = addTodo(state, `položka ${i}`).state;
    const phone = new Device(server, state);
    await phone.signIn("u1");

    const up = phone.progress.filter((p): p is SyncProgress => p?.direction === "up");
    const total = up[0].total!;
    expect(total).toBeGreaterThan(PUSH_BATCH);
    expect(up.map((p) => p.done)).toEqual([0, PUSH_BATCH, total]);
    expect(phone.progress[phone.progress.length - 1]).toBeNull();
  });

  it("stahování se ohlásí a skončí i při chybě sítě", async () => {
    const phone = new Device(server, withProject("Telefon"));
    await phone.signIn("u1");
    phone.progress = [];
    server.down = true;

    await expect(phone.engine.sync()).rejects.toThrow();
    expect(phone.progress).toEqual([null]);
  });
});
