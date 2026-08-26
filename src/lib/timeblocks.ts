import { todayISO } from "./date";
import { isTaskDone, taskById } from "./projects";
import { toggleTodo } from "./todos";
import type { ISODate, MicroWinsState, Task, TimeBlock, Todo } from "./types";
import { createId } from "./utils";

/**
 * Timeblocking - den rozkrájený na bloky.
 *
 * Plán je schválně **hloupý**: blok ví jen kdy začíná, jak dlouho trvá a co se
 * v něm dělá. Žádné procenta, žádné opakování, žádné napojení na kalendář.
 * Všechno, co v appce nese postup, už má svoje místo (úkoly v projektech,
 * seznam v ToDo) - plán dne odpovídá na jinou otázku: *kdy* na to bude čas.
 *
 * Dvě věci, které z toho plynou a drží se v celém modulu:
 *
 * 1. **Bloky se smějí překrývat.** Ubránit se překryvu by znamenalo bloky
 *    odstrkávat nebo zakazovat puštění - obojí je horší než dva bloky vedle
 *    sebe, ze kterých je na první pohled vidět, že si člověk naplánoval dvě
 *    věci naráz. Kreslení to řeší sloupci, viz `layoutDay`.
 * 2. **Čas je minuta od půlnoci, ne `Date`.** Plán je vlastnost dne, ne
 *    okamžiku; s čísly se počítá bez pastí na letní čas a den se ukládá stejně
 *    jako všude jinde v appce - `YYYY-MM-DD` v lokálním čase.
 *
 * Čisté funkce, žádný React ani localStorage - viz timeblocks.test.ts.
 */

/** Krok, na který se plán zarovnává. Menší se prstem netrefí, větší je hrubý. */
export const SLOT = 15;

/** Nejkratší blok. Pod tímhle už není co uchopit ani přečíst. */
export const MIN_DURATION = 15;

/** Nejdelší blok - přes půlnoc se plán netáhne, den končí. */
export const DAY_MINUTES = 24 * 60;

/** Výchozí délka nového bloku. Půlhodina se dá zvětšit tahem za spodní hranu. */
export const DEFAULT_DURATION = 30;

/** Nabídka délek v editoru bloku, v minutách. */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;

export const TIMEBLOCK_MAX_TITLE = 120;

export function snapMinutes(minutes: number, step: number = SLOT): number {
  return Math.round(minutes / step) * step;
}

export function clampStart(start: number, duration: number): number {
  const max = DAY_MINUTES - Math.min(duration, DAY_MINUTES);
  return Math.min(Math.max(0, Math.round(start)), Math.max(0, max));
}

export function clampDuration(duration: number, start: number): number {
  const room = DAY_MINUTES - start;
  return Math.min(Math.max(MIN_DURATION, Math.round(duration)), Math.max(MIN_DURATION, room));
}

// --- výpis ------------------------------------------------------------------

/** Bloky jednoho dne, odshora dolů. Delší dřív - kratší se pak vejde vedle. */
export function blocksOfDay(state: MicroWinsState, date: ISODate): TimeBlock[] {
  return state.timeBlocks
    .filter((b) => b.date === date)
    .sort((a, b) => a.start - b.start || b.duration - a.duration || a.createdAt.localeCompare(b.createdAt));
}

export function blockById(state: MicroWinsState, id: string): TimeBlock | undefined {
  return state.timeBlocks.find((b) => b.id === id);
}

export function blockEnd(block: TimeBlock): number {
  return Math.min(DAY_MINUTES, block.start + block.duration);
}

export function overlaps(a: TimeBlock, b: TimeBlock): boolean {
  return a.start < blockEnd(b) && b.start < blockEnd(a);
}

/** Kolik minut dne je zabraných (překryv se počítá jednou). */
export function plannedMinutes(blocks: TimeBlock[]): number {
  const spans = [...blocks].sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = -1;
  for (const block of spans) {
    const start = Math.max(block.start, cursor);
    const end = blockEnd(block);
    if (end > start) total += end - start;
    cursor = Math.max(cursor, end);
  }
  return total;
}

export function doneMinutes(blocks: TimeBlock[]): number {
  return plannedMinutes(blocks.filter((b) => b.doneAt !== null));
}

/**
 * Rozvrstvení překrývajících se bloků do sloupců.
 *
 * Bloky, které si sahají do času, tvoří shluk; uvnitř shluku dostane každý
 * první sloupec, který je v jeho čase volný. Šířka se pak počítá z počtu
 * sloupců **celého shluku**, aby na sebe sousední bloky navazovaly a
 * nepřeskakovaly o půl obrazovky.
 */
export interface BlockLayout {
  block: TimeBlock;
  column: number;
  columns: number;
}

export function layoutDay(blocks: TimeBlock[]): BlockLayout[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || blockEnd(a) - blockEnd(b));
  const out: BlockLayout[] = [];

  let cluster: BlockLayout[] = [];
  let clusterEnd = -1;
  const columnEnds: number[] = [];

  const flush = () => {
    const columns = columnEnds.length || 1;
    for (const item of cluster) out.push({ ...item, columns });
    cluster = [];
    columnEnds.length = 0;
    clusterEnd = -1;
  };

  for (const block of sorted) {
    if (cluster.length > 0 && block.start >= clusterEnd) flush();

    let column = columnEnds.findIndex((end) => end <= block.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(blockEnd(block));
    } else {
      columnEnds[column] = blockEnd(block);
    }

    cluster.push({ block, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, blockEnd(block));
  }
  if (cluster.length > 0) flush();

  return out.sort((a, b) => a.block.start - b.block.start || a.column - b.column);
}

/**
 * První volno pro blok dané délky, hledáno od `from` po `SLOT`.
 *
 * Když do konce dne nic nezbylo, vrátí `from` zarovnané na krok - blok se pak
 * s něčím překryje, ale vznikne. Odmítnout ťuknutí je horší: uživatel by
 * nevěděl, jestli se to nepovedlo, nebo se jen nic nestalo.
 */
export function nextFreeSlot(
  blocks: TimeBlock[],
  from: number,
  duration: number = DEFAULT_DURATION,
): number {
  const start = clampStart(snapMinutes(Math.max(0, from)), duration);
  const busy = [...blocks].sort((a, b) => a.start - b.start);

  for (let candidate = start; candidate + duration <= DAY_MINUTES; candidate += SLOT) {
    const hit = busy.find((b) => candidate < blockEnd(b) && b.start < candidate + duration);
    if (!hit) return candidate;
    // Přeskoč rovnou za blok, který překáží - po patnácti minutách bychom
    // se stejně doťukali sem.
    candidate = Math.max(candidate, snapMinutes(blockEnd(hit)) - SLOT);
  }
  return start;
}

// --- změny ------------------------------------------------------------------

export interface BlockInput {
  date: ISODate;
  start: number;
  duration?: number;
  title?: string;
  todoId?: string | null;
  taskId?: string | null;
}

export function addBlock(
  state: MicroWinsState,
  input: BlockInput,
  now: Date = new Date(),
): { state: MicroWinsState; block: TimeBlock } {
  // Zarovnává se i délka, ne jen začátek: celý plán jede po čtvrthodinách
  // a jeden blok "na 37 minut" by v mřížce trčel.
  const duration = clampDuration(snapMinutes(input.duration ?? DEFAULT_DURATION), 0);
  const start = clampStart(snapMinutes(input.start), duration);
  const block: TimeBlock = {
    id: createId("blk"),
    date: input.date,
    start,
    duration: clampDuration(duration, start),
    title: (input.title ?? "").trim().slice(0, TIMEBLOCK_MAX_TITLE),
    todoId: input.todoId ?? null,
    taskId: input.taskId ?? null,
    createdAt: now.toISOString(),
    doneAt: null,
  };
  return { state: { ...state, timeBlocks: [...state.timeBlocks, block] }, block };
}

function patchBlock(
  state: MicroWinsState,
  id: string,
  patch: (block: TimeBlock) => TimeBlock,
): MicroWinsState {
  const block = state.timeBlocks.find((b) => b.id === id);
  if (!block) return state;
  const next = patch(block);
  if (
    next.start === block.start &&
    next.duration === block.duration &&
    next.title === block.title &&
    next.date === block.date &&
    next.doneAt === block.doneAt
  ) {
    return state;
  }
  return { ...state, timeBlocks: state.timeBlocks.map((b) => (b.id === id ? next : b)) };
}

/** Posun v rámci dne. Délka se drží, blok se jen nepustí přes půlnoc. */
export function moveBlock(state: MicroWinsState, id: string, start: number): MicroWinsState {
  return patchBlock(state, id, (block) => ({
    ...block,
    start: clampStart(snapMinutes(start), block.duration),
  }));
}

/** Tah za spodní hranu. Začátek se nehýbe, délka se ořízne koncem dne. */
export function resizeBlock(state: MicroWinsState, id: string, duration: number): MicroWinsState {
  return patchBlock(state, id, (block) => ({
    ...block,
    duration: clampDuration(snapMinutes(duration), block.start),
  }));
}

export function updateBlock(
  state: MicroWinsState,
  id: string,
  patch: { title?: string; start?: number; duration?: number; date?: ISODate },
): MicroWinsState {
  return patchBlock(state, id, (block) => {
    const duration = clampDuration(
      patch.duration === undefined ? block.duration : snapMinutes(patch.duration),
      0,
    );
    const start = clampStart(
      patch.start === undefined ? block.start : snapMinutes(patch.start),
      duration,
    );
    return {
      ...block,
      date: patch.date ?? block.date,
      start,
      duration: clampDuration(duration, start),
      title:
        patch.title === undefined ? block.title : patch.title.trim().slice(0, TIMEBLOCK_MAX_TITLE),
    };
  });
}

/** Přesun na jiný den - čas zůstává, protože "v devět" platí i zítra. */
export function moveBlockToDay(state: MicroWinsState, id: string, date: ISODate): MicroWinsState {
  return patchBlock(state, id, (block) => ({ ...block, date }));
}

export function deleteBlock(state: MicroWinsState, id: string): MicroWinsState {
  if (!state.timeBlocks.some((b) => b.id === id)) return state;
  return { ...state, timeBlocks: state.timeBlocks.filter((b) => b.id !== id) };
}

export function restoreBlock(state: MicroWinsState, block: TimeBlock): MicroWinsState {
  if (state.timeBlocks.some((b) => b.id === block.id)) return state;
  return { ...state, timeBlocks: [...state.timeBlocks, block] };
}

/**
 * Odškrtnutí bloku.
 *
 * Blok vzniklý z položky ToDo odškrtne **i tu položku**: je to jedna a ta samá
 * věc viděná ze dvou stran a odškrtávat ji dvakrát je práce navíc, kterou
 * nikdo nechce. Úkolu projektu se to nedělá - ten má hodnotu a cíl, a nastavit
 * ho na sto procent za odsezenou hodinu by lhalo o postupu.
 */
export function toggleBlockDone(
  state: MicroWinsState,
  id: string,
  now: Date = new Date(),
): MicroWinsState {
  const block = state.timeBlocks.find((b) => b.id === id);
  if (!block) return state;
  const done = block.doneAt === null;

  let next: MicroWinsState = {
    ...state,
    timeBlocks: state.timeBlocks.map((b) =>
      b.id === id ? { ...b, doneAt: done ? now.toISOString() : null } : b,
    ),
  };

  if (block.todoId) {
    const todo = next.todos.find((t) => t.id === block.todoId);
    if (todo && (todo.doneAt !== null) !== done) next = toggleTodo(next, todo.id, now);
  }
  return next;
}

// --- popisky ----------------------------------------------------------------

/** "9:30". Bez vedoucí nuly - v mřížce hodin se čte líp. */
export function formatMinutes(minutes: number): string {
  const total = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "9:30-10:15" jako jeden popisek bloku. */
export function formatSpan(block: TimeBlock): string {
  return `${formatMinutes(block.start)}-${formatMinutes(blockEnd(block))}`;
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatLength(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** "9:30" -> 570. Nesmysl vrací null, ať se z pole nedá vyrobit rozbitý blok. */
export function parseMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Co v bloku stojí. Napojený úkol nebo položka mají přednost před uloženým
 * textem - přejmenovaná věc se má propsat i do plánu. Když odkaz nikam nevede
 * (smazaná položka), zbyde text, se kterým blok vznikl.
 */
export function blockTitle(state: MicroWinsState, block: TimeBlock): string {
  if (block.todoId) {
    const todo = state.todos.find((t) => t.id === block.todoId);
    if (todo) return todo.text;
  }
  if (block.taskId) {
    const task = taskById(state, block.taskId);
    if (task) return task.name;
  }
  return block.title || "Blok";
}

// --- co ještě není v plánu --------------------------------------------------

/** Otevřené položky ToDo, které v daném dni ještě nemají blok. */
export function unplannedTodos(state: MicroWinsState, date: ISODate): Todo[] {
  const planned = new Set(
    state.timeBlocks.filter((b) => b.date === date && b.todoId).map((b) => b.todoId),
  );
  return state.todos
    .filter((t) => !t.doneAt && !planned.has(t.id))
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Nedokončené úkoly projektů, které v daném dni nemají blok. Archivované
 * projekty se vynechávají - kdo si projekt uklidil, nechce ho vidět v plánu.
 */
export function unplannedTasks(state: MicroWinsState, date: ISODate): Task[] {
  const planned = new Set(
    state.timeBlocks.filter((b) => b.date === date && b.taskId).map((b) => b.taskId),
  );
  const archived = new Set(
    state.projects.filter((p) => p.archivedAt !== null).map((p) => p.id),
  );
  const today = todayISO();

  return state.tasks
    .filter(
      (t) => !planned.has(t.id) && !archived.has(t.projectId) && !isTaskDone(state, t),
    )
    .sort((a, b) => {
      // Napřed to, co hoří: termín dřív, pak zbytek v pořadí projektu.
      const aDue = a.dueDate ?? "9999-99-99";
      const bDue = b.dueDate ?? "9999-99-99";
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      const aLate = a.dueDate !== null && a.dueDate < today ? 0 : 1;
      const bLate = b.dueDate !== null && b.dueDate < today ? 0 : 1;
      if (aLate !== bLate) return aLate - bLate;
      return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
    });
}
