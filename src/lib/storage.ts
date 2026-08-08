import { EMPTY_STATE, STATE_VERSION, type MicroWinsState } from "./types";

export const STORAGE_KEY = "microwins:v1";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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
      tasks: arr("tasks"),
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
