import { isValidISODate } from "./date";
import { KIND_ORDER } from "./domain";
import { DAY_MINUTES, MIN_DURATION } from "./timeblocks";
import { isValidTime } from "./todos";
import {
  EMPTY_STATE,
  STATE_VERSION,
  type MicroWinsState,
  type Task,
  type TimeBlock,
  type Todo,
  type TreeNode,
} from "./types";

export const STORAGE_KEY = "microwins:v1";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function whole(value: unknown, min: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : min;
}

/**
 * Hodnoty úkolů jedou v celých číslech. Starší data ale desetinná obsahovat
 * můžou - posuvník kdysi jezdil po desetinách a v seznamu z toho bylo
 * "13,6 / 20". Srovná se to při načtení, uloží se srovnané.
 */
function normalizeTask(task: Task): Task {
  const target = whole(task.target, 1);
  const current = Math.min(whole(task.current, 0), target);
  const step = whole(task.step, 1);
  /* 0 je platná váha - takový úkol se do procent nepočítá. Chybějící váha ale
     znamená "běžný úkol": cizí nebo starý JSON bez `weight` by s nulou tiše
     přestal hýbat procenty projektu. */
  const weight = task.weight === undefined ? 1 : whole(task.weight, 0);
  if (
    target === task.target &&
    current === task.current &&
    step === task.step &&
    weight === task.weight
  ) {
    return task;
  }
  return { ...task, target, current, step, weight };
}

/**
 * Zrušené klíče ze starších verzí. Zůstat by mohly - typ o nich neví - ale
 * pak by se při každém uložení psaly zpátky na disk a `pushExempt` by tam
 * strašil i za rok. Načtení je jediné místo, kde je vidět a jde je zahodit.
 */
const DROPPED_NODE_KEYS = ["pushExempt"] as const;

function normalizeNode(node: TreeNode): TreeNode {
  const record = node as unknown as Record<string, unknown>;
  if (!DROPPED_NODE_KEYS.some((key) => key in record)) return node;
  const next = { ...record };
  for (const key of DROPPED_NODE_KEYS) delete next[key];
  return next as unknown as TreeNode;
}

/**
 * Verze, od které pořadí ve stromu určuje pořadí v poli `nodes`.
 *
 * Do v5 se obsah složky při vykreslení dotřiďoval podle druhu a data vzniku,
 * takže přetažení sice pole přeuspořádalo, ale na obrazovce se nic nezměnilo.
 * Řazení při vykreslení je pryč; aby stará data vypadala pořád stejně, srovná
 * se pole jednou při načtení podle původního pravidla. Novější data se už
 * nesahá - to by uživateli smazalo jeho ruční pořadí při každém startu.
 */
const NODE_ORDER_VERSION = 6;

function sortNodesByLegacyOrder(nodes: TreeNode[]): TreeNode[] {
  // Stačí globální seřazení: `childrenOf` bere jen sourozence, a jejich
  // vzájemné pořadí vyjde stejně, jako když se řadila každá složka zvlášť.
  return [...nodes].sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Položka ToDo z cizího JSONu. Text je jediné, co musí být - bez něj není co
 * ukazovat. Chybějící `doneAt` znamená otevřenou položku, ne vypršelou,
 * a chybějící termín položku bez termínu (data z verzí před v7).
 */
function normalizeTodos(raw: unknown[]): Todo[] {
  const out: Todo[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) return;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) return;
    const dueDate =
      typeof item.dueDate === "string" && isValidISODate(item.dueDate) ? item.dueDate : null;
    out.push({
      id: typeof item.id === "string" && item.id ? item.id : `tdo_${index}`,
      text,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      doneAt: typeof item.doneAt === "string" ? item.doneAt : null,
      order: typeof item.order === "number" && Number.isFinite(item.order) ? item.order : index,
      dueDate,
      // Hodina bez dne nedává smysl - stejné pravidlo jako v `setTodoDue`.
      dueTime:
        dueDate && typeof item.dueTime === "string" && isValidTime(item.dueTime)
          ? item.dueTime
          : null,
    });
  });
  return out;
}

/**
 * Časový blok z cizího JSONu. Bez dne a rozumného času není co kreslit, takže
 * takový záznam padá pod stůl; zbytek se srovná do mezí (0-1440 minut).
 */
function normalizeTimeBlocks(raw: unknown[]): TimeBlock[] {
  const out: TimeBlock[] = [];
  raw.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (typeof item.date !== "string" || !isValidISODate(item.date)) return;
    const start = typeof item.start === "number" && Number.isFinite(item.start) ? item.start : -1;
    if (start < 0 || start >= DAY_MINUTES) return;
    const duration =
      typeof item.duration === "number" && Number.isFinite(item.duration) ? item.duration : 0;

    out.push({
      id: typeof item.id === "string" && item.id ? item.id : `blk_${index}`,
      date: item.date,
      start: Math.round(start),
      duration: Math.min(Math.max(MIN_DURATION, Math.round(duration)), DAY_MINUTES - Math.round(start)),
      title: typeof item.title === "string" ? item.title.slice(0, 120) : "",
      todoId: typeof item.todoId === "string" && item.todoId ? item.todoId : null,
      taskId: typeof item.taskId === "string" && item.taskId ? item.taskId : null,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      doneAt: typeof item.doneAt === "string" ? item.doneAt : null,
    });
  });
  return out;
}

function migrateNodeOrder(nodes: TreeNode[], version: number): TreeNode[] {
  return version < NODE_ORDER_VERSION ? sortNodesByLegacyOrder(nodes) : nodes;
}

/** Tolerantní validace - poškozený nebo cizí JSON raději zahodíme, než abychom spadli. */
export function parseState(raw: string): MicroWinsState | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    if (!Array.isArray(data.nodes) || !Array.isArray(data.entries)) return null;
    const arr = <K extends keyof MicroWinsState>(key: K): MicroWinsState[K] =>
      (Array.isArray(data[key]) ? data[key] : []) as MicroWinsState[K];

    // Starší export (v1) neznal projekty - doplní se jako prázdné.
    return {
      version: STATE_VERSION,
      nodes: migrateNodeOrder(
        (data.nodes as MicroWinsState["nodes"]).map(normalizeNode),
        typeof data.version === "number" ? data.version : 0,
      ),
      entries: data.entries as MicroWinsState["entries"],
      microwins: arr("microwins"),
      projects: arr("projects"),
      tasks: arr("tasks").map(normalizeTask),
      // Milníky z v2 neznaly odškrtnutí - doplní se jako neodškrtnuté.
      milestones: arr("milestones").map((m) => (m.doneAt === undefined ? { ...m, doneAt: null } : m)),
      snapshots: arr("snapshots"),
      taskSnapshots: arr("taskSnapshots"),
      // ToDo přišlo až v v5 - starší zálohy ho neznají a začnou s prázdným.
      todos: normalizeTodos(Array.isArray(data.todos) ? data.todos : []),
      // Plán dne až v v7 - totéž.
      timeBlocks: normalizeTimeBlocks(Array.isArray(data.timeBlocks) ? data.timeBlocks : []),
    };
  } catch {
    return null;
  }
}

export function loadState(): MicroWinsState {
  if (typeof window === "undefined") return EMPTY_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY_STATE;
  return parseState(raw) ?? EMPTY_STATE;
}

export function saveState(state: MicroWinsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // plné úložiště / private mode - data zůstanou aspoň v paměti
  }
}

/**
 * Záloha a obnova žijí v `lib/backup.ts` - kromě stavu musí umět i nastavení
 * a v nativní appce zapsat soubor, protože stahovací odkaz ve WebView nefunguje.
 */
