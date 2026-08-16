/**
 * Testovací data pro vývoj projektové sekce.
 *
 * Nespouští se samo. Nasadí se jen z adresy `?seed` a jen v dev buildu -
 * `applyDevSeed` v produkci vrátí stav beze změny. Až testovací data
 * nebudou potřeba, smaž tenhle soubor a jeho volání ve `store-provider.tsx`.
 *
 * Dny jsou relativní ke dnešku, takže data nezestárnou - deadliny, termíny
 * i historie postupu sedí, ať se seed spustí kdykoli.
 */
import { addCategory, addCheck, addEntry, addMetric, addOnce, toggleCheck } from "./actions";
import { addDays, todayISO } from "./date";
import { projectPercent, taskPercent } from "./projects";
import {
  EMPTY_STATE,
  type ISODate,
  type MicroWinsState,
  type Milestone,
  type Project,
  type Snapshot,
  type Task,
  type TaskSnapshot,
} from "./types";

/** Deterministický šum - stejný seed dá pokaždé stejnou historii. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TaskSpec {
  key: string;
  name: string;
  icon?: string;
  target: number;
  current: number;
  unit?: string;
  step?: number;
  weight?: number;
  due?: number;
  milestone?: string;
  description?: string;
  children?: TaskSpec[];
}

interface ProjectSpec {
  key: string;
  name: string;
  icon: string;
  start: number;
  deadline: number | null;
  description?: string;
  archived?: boolean;
  /** O kolik bodů byl projekt včera pozadu - dnešní přírůstek v seznamu. */
  bump?: number;
  milestones?: { key: string; name: string; date: number; done?: boolean }[];
  tasks: TaskSpec[];
}

const SPECS: ProjectSpec[] = [
  {
    key: "app",
    name: "MicroWins v2",
    icon: "🚀",
    start: -64,
    deadline: 18,
    description: "Projektová sekce, statistiky a pořádný import dat.",
    bump: 2.4,
    tasks: [
      {
        key: "sekce",
        name: "Projektová sekce",
        icon: "🧱",
        target: 1,
        current: 0,
        weight: 2,
        children: [
          { key: "seznam", name: "Seznam projektů", target: 1, current: 1 },
          { key: "detail", name: "Detail projektu", target: 1, current: 1 },
          { key: "drag", name: "Přetahování pořadí", target: 1, current: 1 },
          { key: "grafy", name: "Grafy postupu", target: 1, current: 0 },
        ],
      },
      {
        key: "testy",
        name: "Napsat testy",
        icon: "🧪",
        target: 120,
        current: 86,
        unit: "testů",
        step: 5,
      },
      {
        key: "docs",
        name: "Dokumentace",
        icon: "📝",
        target: 12,
        current: 7,
        unit: "stran",
        due: 3,
        description: "README, ANDROID.md a popis datového modelu.",
      },
    ],
  },
  {
    key: "maraton",
    name: "Maraton pod 4 hodiny",
    icon: "🏃",
    start: -120,
    deadline: 95,
    description: "Podzimní maraton. Cílový čas 3:59.",
    bump: 0.8,
    milestones: [
      { key: "pulmaraton", name: "Půlmaraton naostro", date: 30 },
      { key: "start", name: "Startovní výstřel", date: 95 },
    ],
    tasks: [
      {
        key: "km",
        name: "Naběhat kilometry",
        icon: "👟",
        target: 800,
        current: 214,
        unit: "km",
        step: 5,
        weight: 3,
      },
      {
        key: "dlouhe",
        name: "Dlouhé běhy",
        icon: "🛣️",
        target: 16,
        current: 5,
        unit: "běhů",
        due: 0,
        milestone: "pulmaraton",
      },
      { key: "vaha", name: "Zhubnout", icon: "⚖️", target: 8, current: 6, unit: "kg" },
    ],
  },
  {
    key: "koupelna",
    name: "Rekonstrukce koupelny",
    icon: "🔨",
    start: -150,
    deadline: -9,
    description: "Mělo být hotové před dovolenou. Nebylo.",
    bump: 0,
    tasks: [
      { key: "obklady", name: "Obklady", icon: "🧱", target: 24, current: 24, unit: "m²", step: 2 },
      { key: "instalace", name: "Instalatér hotov", icon: "🚿", target: 1, current: 1 },
      {
        key: "malovani",
        name: "Vymalovat",
        icon: "🎨",
        target: 45,
        current: 12,
        unit: "m²",
        step: 5,
        due: -4,
      },
    ],
  },
  {
    key: "spanelstina",
    name: "Španělština do B1",
    icon: "🇪🇸",
    start: -200,
    deadline: null,
    description: "Bez termínu. Jede se, dokud to nesedne.",
    bump: 1.2,
    tasks: [
      {
        key: "slovicka",
        name: "Slovíčka",
        icon: "🗂️",
        target: 2000,
        current: 1240,
        unit: "slov",
        step: 20,
        weight: 2,
      },
      { key: "lekce", name: "Lekce v učebnici", icon: "📖", target: 60, current: 41 },
      { key: "konverzace", name: "Konverzace s lektorem", icon: "💬", target: 30, current: 9, unit: "hodin" },
    ],
  },
  {
    key: "knihy",
    name: "Přečíst 24 knih",
    icon: "📚",
    start: -224,
    deadline: 140,
    description: "Dvě knihy měsíčně, celý rok.",
    bump: 1.6,
    milestones: [
      { key: "pulka", name: "Půlka roku", date: -42, done: true },
      { key: "posledni", name: "Poslední kniha", date: 140 },
    ],
    tasks: [
      {
        key: "q1",
        name: "1. čtvrtletí",
        icon: "❄️",
        target: 1,
        current: 0,
        children: quarter("q1", 6, 6),
      },
      {
        key: "q2",
        name: "2. čtvrtletí",
        icon: "🌱",
        target: 1,
        current: 0,
        milestone: "pulka",
        children: quarter("q2", 6, 5),
      },
      {
        key: "q3",
        name: "3. čtvrtletí",
        icon: "☀️",
        target: 1,
        current: 0,
        children: quarter("q3", 6, 2),
      },
      {
        key: "q4",
        name: "4. čtvrtletí",
        icon: "🍂",
        target: 1,
        current: 0,
        children: quarter("q4", 6, 0),
      },
    ],
  },
  {
    key: "garaz",
    name: "Vyklidit garáž",
    icon: "📦",
    start: -40,
    deadline: -2,
    description: "Hotovo, i když o dva dny později.",
    bump: 3.5,
    tasks: [
      { key: "kramy", name: "Vyházet krámy", icon: "🗑️", target: 30, current: 30, unit: "beden", step: 2 },
      { key: "police", name: "Postavit police", icon: "🪚", target: 1, current: 1 },
    ],
  },
  {
    key: "foto",
    name: "Kurz fotografování",
    icon: "📷",
    start: -300,
    deadline: -120,
    description: "Nedodělané, odloženo do archivu.",
    archived: true,
    bump: 0,
    tasks: [
      { key: "lekce", name: "Lekce", icon: "🎞️", target: 10, current: 7 },
      { key: "vystava", name: "Vlastní výstava", icon: "🖼️", target: 1, current: 0 },
    ],
  },
];

/** Čtvrtletí knih - `done` z `count` je přečtených. */
function quarter(prefix: string, count: number, done: number): TaskSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${prefix}k${i + 1}`,
    name: `Kniha ${i + 1}`,
    icon: "📕",
    target: 1,
    current: i < done ? 1 : 0,
  }));
}

function buildState(today: ISODate): MicroWinsState {
  const stamp = (offset: number) => `${addDays(today, offset)}T09:00:00.000Z`;
  const projects: Project[] = [];
  const tasks: Task[] = [];
  const milestones: Milestone[] = [];

  SPECS.forEach((spec, index) => {
    const projectId = `seed_prj_${spec.key}`;
    projects.push({
      id: projectId,
      name: spec.name,
      icon: spec.icon,
      startDate: addDays(today, spec.start),
      deadline: spec.deadline === null ? null : addDays(today, spec.deadline),
      description: spec.description ?? "",
      order: index,
      createdAt: stamp(spec.start),
      archivedAt: spec.archived ? stamp(spec.start + 10) : null,
    });

    for (const m of spec.milestones ?? []) {
      milestones.push({
        id: `seed_ms_${spec.key}_${m.key}`,
        projectId,
        name: m.name,
        date: addDays(today, m.date),
        createdAt: stamp(spec.start),
        doneAt: m.done ? stamp(m.date) : null,
      });
    }

    const push = (list: TaskSpec[], parentId: string | null) => {
      list.forEach((t, order) => {
        const id = `seed_tsk_${spec.key}_${t.key}`;
        tasks.push({
          id,
          projectId,
          parentId,
          name: t.name,
          icon: t.icon ?? "",
          target: t.target,
          current: t.current,
          unit: t.unit,
          step: t.step ?? 1,
          weight: t.weight ?? 1,
          dueDate: t.due === undefined ? null : addDays(today, t.due),
          milestoneId: t.milestone ? `seed_ms_${spec.key}_${t.milestone}` : null,
          description: t.description ?? "",
          order,
          createdAt: stamp(spec.start + 1),
          completedAt: t.target > 0 && t.current >= t.target ? stamp(-3) : null,
        });
        if (t.children) push(t.children, id);
      });
    };
    push(spec.tasks, null);
  });

  const tree = buildTree(today);
  const base: MicroWinsState = { ...EMPTY_STATE, ...tree, projects, tasks, milestones };
  return {
    ...base,
    snapshots: buildSnapshots(base, today),
    taskSnapshots: buildTaskSnapshots(base, today),
  };
}

/** Kolik microwinů má seed vyrobit - dost na to, aby statistiky měly co kreslit. */
const WIN_TARGET = 49;

/**
 * Strom microwinů s devadesáti dny historie.
 *
 * Staví se skutečnými akcemi, ne ručně poskládaným polem: microwin padá jen
 * za den, ke kterému se zápis dělá, takže se historie musí odehrát den po dni.
 * Ručně vyrobené microwiny by neseděly na záznamech a statistiky by z nich
 * počítaly nesmysly.
 *
 * Aby počet vyšel na `WIN_TARGET` přesně, jsou zdroje microwinů oddělené:
 *  - metrika dostane rekord hned první den a všechny další hodnoty leží pod
 *    ním, takže už žádný microwin nedá,
 *  - zaškrtávací win je pak jediný zdroj, který se dá počítat po jednom.
 *
 * Vedlejší efekt je realistický: denní součty kliků drží pásmo 30-40 s rekordem
 * na 40, takže grafy nevypadají jako náhodný šum.
 */
function buildTree(today: ISODate): Pick<MicroWinsState, "nodes" | "entries" | "microwins"> {
  const random = rng(4242);
  let state: MicroWinsState = EMPTY_STATE;

  const business = addCategory(state, null, "Business");
  state = business.state;
  const calls = addCategory(state, business.node.id, "cold calls");
  state = calls.state;
  const callMetric = addMetric(state, calls.node.id, { name: "X cold calls za den", unit: "ks" });
  state = callMetric.state;

  const zdravi = addCategory(state, null, "Zdraví");
  state = zdravi.state;
  const kliky = addMetric(state, zdravi.node.id, { name: "X kliků", unit: "ks" });
  state = kliky.state;
  const strech = addCheck(state, zdravi.node.id, "Ranní protažení");
  state = strech.state;

  const uceni = addCategory(state, null, "Učení");
  state = uceni.state;
  const strany = addMetric(state, uceni.node.id, { name: "X stran přečteno", unit: "stran" });
  state = strany.state;

  const START = -90;
  /** Kdy „Učení" utichlo - podklad pro výzvu Návrat. */
  const QUIET_FROM = -25;

  const write = (metricId: string, value: number, offset: number) => {
    const day = addDays(today, offset);
    state = addEntry(state, { metricId, value, date: day }, day).state;
  };

  // Rekordy padnou první den. Všechno pozdější leží pod nimi.
  write(kliky.node.id, 40, START);
  write(callMetric.node.id, 12, START);
  write(strany.node.id, 35, START);

  for (let offset = START + 1; offset <= 0; offset++) {
    if (random() < 0.8) write(kliky.node.id, 30 + Math.round(random() * 9), offset);
    if (random() < 0.35) write(callMetric.node.id, 4 + Math.round(random() * 7), offset);
    if (offset < QUIET_FROM && random() < 0.45) {
      write(strany.node.id, 10 + Math.round(random() * 20), offset);
    }
  }

  state = addOnce(
    state,
    business.node.id,
    {
      name: "Odeslal jsem první nabídku",
      date: addDays(today, -70),
      note: "Konečně. Trvalo to půl roku.",
    },
    today,
  ).state;

  /* Zaškrtávání jde od dneška zpět, ne od začátku: kdyby se plnily nejstarší
     dny, poslední měsíc by zůstal prázdný a appka by se otevřela s nulovou
     sérií. Takhle je čerstvá historie hustá a řídne směrem do minulosti. */
  for (let offset = 0; offset >= START && state.microwins.length < WIN_TARGET; offset--) {
    if (random() < 0.75) {
      state = toggleCheck(state, strech.node.id, addDays(today, offset), addDays(today, offset)).state;
    }
  }

  return { nodes: state.nodes, entries: state.entries, microwins: state.microwins };
}

/**
 * Otisky úkolů. Stačí dva na úkol: nula na startu projektu a včerejšek kousek
 * pod dnešní hodnotou - z toho appka spočítá „+X % dnes" u každého úkolu.
 * Bez nich by se úkoly tvářily, že se dnes nepohnuly.
 */
function buildTaskSnapshots(state: MicroWinsState, today: ISODate): TaskSnapshot[] {
  const out: TaskSnapshot[] = [];
  const startOf = new Map(SPECS.map((s) => [`seed_prj_${s.key}`, s.start]));

  state.tasks.forEach((task, index) => {
    const percent = taskPercent(state, task);
    const start = startOf.get(task.projectId) ?? -30;
    // Trochu jiný přírůstek u každého úkolu - jednotné číslo by v seznamu
    // vypadalo jako chyba výpočtu.
    const bump = percent === 0 ? 0 : [0, 1.5, 4, 0, 2.5, 8][index % 6];
    out.push({ taskId: task.id, date: addDays(today, start), percent: 0 });
    if (bump > 0) {
      out.push({
        taskId: task.id,
        date: addDays(today, -1),
        percent: Math.max(0, Math.round((percent - bump) * 10) / 10),
      });
    }
  });

  return out;
}

/**
 * Historie postupu. Bez otisků by graf i deník změn byly u každého projektu
 * jedna přímka - tady se postup rozprostře po dnech od startu do včerejška
 * a dnešek dopočítá appka z aktuálních hodnot úkolů.
 */
function buildSnapshots(state: MicroWinsState, today: ISODate): Snapshot[] {
  const out: Snapshot[] = [];

  SPECS.forEach((spec, index) => {
    const projectId = `seed_prj_${spec.key}`;
    const final = projectPercent(state, projectId);
    const end = Math.max(0, final - (spec.bump ?? 1));
    const days = Math.abs(spec.start);
    const random = rng(index * 7919 + 13);

    // Náhodné přírůstky, ne rovnoměrný růst - jinak vypadá graf jako pravítko.
    const steps: number[] = [];
    let total = 0;
    for (let i = 0; i < days; i++) {
      const gain = random() < 0.42 ? random() : 0;
      steps.push(gain);
      total += gain;
    }

    out.push({ projectId, date: addDays(today, spec.start), percent: 0 });
    if (total === 0) return;

    let acc = 0;
    for (let i = 0; i < days; i++) {
      acc += (steps[i] / total) * end;
      if (steps[i] === 0) continue;
      out.push({
        projectId,
        date: addDays(today, spec.start + i + 1),
        percent: Math.round(acc * 10) / 10,
      });
    }
  });

  return out;
}

/**
 * Nasadí testovací data, když je v adrese `?seed`. `?seed=reset` naopak
 * všechno smaže. Parametr se hned zahodí, aby obnovení stránky data
 * nepřepsalo přes rozdělanou práci.
 */
export function applyDevSeed(loaded: MicroWinsState): MicroWinsState {
  if (process.env.NODE_ENV === "production") return loaded;
  if (typeof window === "undefined") return loaded;

  const params = new URLSearchParams(window.location.search);
  if (!params.has("seed")) return loaded;

  const mode = params.get("seed");
  params.delete("seed");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname + (query ? `?${query}` : "") + window.location.hash,
  );

  if (mode === "reset") return EMPTY_STATE;
  return buildState(todayISO());
}
