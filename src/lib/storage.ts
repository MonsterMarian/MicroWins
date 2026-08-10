import { EMPTY_STATE, STATE_VERSION, type MicroWinsState, type Task } from "./types";

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
  const weight = whole(task.weight, 1);
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
      nodes: data.nodes as MicroWinsState["nodes"],
      entries: data.entries as MicroWinsState["entries"],
      microwins: arr("microwins"),
      projects: arr("projects"),
      tasks: arr("tasks").map(normalizeTask),
      milestones: arr("milestones"),
      snapshots: arr("snapshots"),
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
