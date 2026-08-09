import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { todayISO } from "./date";
import { isNative } from "./native";
import { parseState } from "./storage";
import { STATE_VERSION, type MicroWinsState } from "./types";

/**
 * Záloha celé appky.
 *
 * Obsahuje úplně všechno, co appka drží: strom (složky, číselné winy,
 * zaškrtávací i jednorázové), záznamy, microwiny, projekty, úkoly, milníky,
 * denní otisky postupu - a k tomu nastavení, které žije mimo hlavní stav.
 *
 * Formát je nadmnožina samotného stavu, takže starší export appky (holý
 * `MicroWinsState`) se načte taky.
 */

export const BACKUP_FORMAT = "microwins-backup";
export const BACKUP_VERSION = 1;

export interface BackupSettings {
  theme?: "dark" | "light";
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  backupVersion: number;
  /** Verze datového modelu, ze kterého záloha vznikla. */
  stateVersion: number;
  exportedAt: string;
  settings: BackupSettings;
  state: MicroWinsState;
}

export const THEME_KEY = "microwins:theme";

export function readSettings(): BackupSettings {
  if (typeof window === "undefined") return {};
  try {
    const theme = window.localStorage.getItem(THEME_KEY);
    return theme === "dark" || theme === "light" ? { theme } : {};
  } catch {
    return {};
  }
}

export function applySettings(settings: BackupSettings): void {
  if (typeof window === "undefined" || !settings.theme) return;
  try {
    window.localStorage.setItem(THEME_KEY, settings.theme);
  } catch {
    // soukromý režim - téma se nezapamatuje, data ale sedí
  }
  document.documentElement.classList.toggle("dark", settings.theme === "dark");
}

export function buildBackup(state: MicroWinsState): Backup {
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    stateVersion: STATE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: readSettings(),
    state,
  };
}

export function serializeBackup(state: MicroWinsState): string {
  return JSON.stringify(buildBackup(state), null, 2);
}

export interface ParsedBackup {
  state: MicroWinsState;
  settings: BackupSettings;
}

/** Přijme nový formát zálohy i holý starý export. */
export function parseBackup(text: string): ParsedBackup | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;

  const record = data as Record<string, unknown>;
  const inner = record.state;

  // Nový formát: { format, state, settings }
  if (inner && typeof inner === "object") {
    const state = parseState(JSON.stringify(inner));
    if (!state) return null;
    const settings = record.settings;
    return {
      state,
      settings:
        settings && typeof settings === "object"
          ? ((settings as BackupSettings).theme === "dark" ||
            (settings as BackupSettings).theme === "light"
              ? { theme: (settings as BackupSettings).theme }
              : {})
          : {},
    };
  }

  // Starší export: rovnou MicroWinsState
  const state = parseState(text);
  return state ? { state, settings: {} } : null;
}

export function backupFilename(): string {
  return `microwins-${todayISO()}.json`;
}

/** Co se stalo s exportem - dialog podle toho napíše, kde soubor hledat. */
export type ExportOutcome =
  | { kind: "shared" }
  | { kind: "saved"; path: string }
  | { kind: "downloaded" }
  | { kind: "failed"; message: string };

/**
 * Export zálohy.
 *
 * V prohlížeči stáhne soubor odkazem. V nativní appce odkaz nefunguje -
 * soubor se zapíše do úložiště a nabídne přes systémové sdílení, takže se dá
 * poslat na Disk, do mailu nebo kamkoli jinam.
 */
export async function exportBackup(state: MicroWinsState): Promise<ExportOutcome> {
  const json = serializeBackup(state);
  const name = backupFilename();

  if (!isNative()) {
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return { kind: "downloaded" };
    } catch (e) {
      return { kind: "failed", message: String(e) };
    }
  }

  try {
    const written = await Filesystem.writeFile({
      path: name,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    try {
      await Share.share({
        title: "Záloha MicroWins",
        text: name,
        url: written.uri,
      });
      return { kind: "shared" };
    } catch {
      // Sdílení uživatel zavřel nebo na zařízení není - soubor už existuje,
      // tak aspoň řekneme kde.
      const saved = await Filesystem.writeFile({
        path: name,
        data: json,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return { kind: "saved", path: saved.uri };
    }
  } catch (e) {
    return { kind: "failed", message: String(e) };
  }
}
