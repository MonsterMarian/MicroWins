import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { todayISO } from "./date";
import { isNative } from "./native";
import { ALL_PARTS, isAllParts, isDataPart, pickParts, type DataPart } from "./parts";
import { getPrefs, parsePrefs, replacePrefs, type Prefs } from "./prefs";
import { setTheme, storedTheme } from "./theme";
import { parseState } from "./storage";
import { STATE_VERSION, type MicroWinsState } from "./types";

/**
 * Záloha appky - celá, nebo jen vybrané části.
 *
 * Úplná záloha obsahuje všechno, co appka drží: strom (složky, číselné winy,
 * zaškrtávací i jednorázové), záznamy, microwiny, projekty, úkoly, milníky,
 * denní otisky postupu, ToDo, plán i time box - a k tomu nastavení, které
 * žije mimo hlavní stav. Záloha části (jen ToDo, jen jedna mapa atomů) nese
 * jen svoje kolekce; ostatní jsou v souboru prázdné a `parts` říká, které
 * v něm opravdu jsou.
 *
 * Formát je nadmnožina samotného stavu, takže starší export appky (holý
 * `MicroWinsState`) se načte taky.
 */

export const BACKUP_FORMAT = "microwins-backup";
/** v2: přibylo `parts` - záloha nemusí být celá. */
export const BACKUP_VERSION = 2;

export interface BackupSettings {
  theme?: "dark" | "light";
  /** Nastavení zobrazení (viz `prefs.ts`). */
  prefs?: Prefs;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  backupVersion: number;
  /** Verze datového modelu, ze kterého záloha vznikla. */
  stateVersion: number;
  exportedAt: string;
  /** Části, které soubor nese. Starší zálohy ho nemají - ty jsou vždy celé. */
  parts: DataPart[];
  settings: BackupSettings;
  state: MicroWinsState;
}

export interface BackupOptions {
  /** Které části do souboru jdou; bez udání všechny. */
  parts?: readonly DataPart[];
  /**
   * Přibalit nastavení? Bez udání jen k úplné záloze - nastavení time boxu
   * v souboru se samotným ToDo by po načtení překvapilo.
   */
  settings?: boolean;
  /** Kousek do jména souboru, ať se zálohy částí nepletou s tou celou. */
  label?: string;
}

export { THEME_KEY } from "./theme";

export function readSettings(): BackupSettings {
  if (typeof window === "undefined") return {};
  const out: BackupSettings = { prefs: getPrefs() };
  const theme = storedTheme();
  if (theme) out.theme = theme;
  return out;
}

export function applySettings(settings: BackupSettings): void {
  if (typeof window === "undefined") return;
  if (settings.prefs) replacePrefs(settings.prefs);
  if (settings.theme) setTheme(settings.theme);
}

export function buildBackup(state: MicroWinsState, options: BackupOptions = {}): Backup {
  const parts = ALL_PARTS.filter((p) => (options.parts ?? ALL_PARTS).includes(p));
  const withSettings = options.settings ?? isAllParts(parts);
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    stateVersion: STATE_VERSION,
    exportedAt: new Date().toISOString(),
    parts,
    settings: withSettings ? readSettings() : {},
    state: pickParts(state, parts),
  };
}

export function serializeBackup(state: MicroWinsState, options: BackupOptions = {}): string {
  return JSON.stringify(buildBackup(state, options), null, 2);
}

export interface ParsedBackup {
  state: MicroWinsState;
  settings: BackupSettings;
  /**
   * Části, které soubor podle sebe nese; `null` = starší záloha bez údaje,
   * tedy celá. Co v nich opravdu je, řekne až `partsIn` ze stavu.
   */
  parts: DataPart[] | null;
}

/** Nese záloha nějaké nastavení, které jde převzít? */
export function hasSettings(settings: BackupSettings): boolean {
  return settings.prefs !== undefined || settings.theme !== undefined;
}

/** Ze zálohy bere jen známé volby - cizí nebo poškozené se zahodí. */
function parseSettings(raw: unknown): BackupSettings {
  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const out: BackupSettings = {};
  if (record.theme === "dark" || record.theme === "light") out.theme = record.theme;
  if (record.prefs !== undefined) out.prefs = parsePrefs(record.prefs);
  return out;
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

  // Nový formát: { format, state, settings, parts }
  if (inner && typeof inner === "object") {
    const state = parseState(JSON.stringify(inner));
    if (!state) return null;
    return {
      state,
      settings: parseSettings(record.settings),
      parts: Array.isArray(record.parts) ? record.parts.filter(isDataPart) : null,
    };
  }

  // Starší export: rovnou MicroWinsState
  const state = parseState(text);
  return state ? { state, settings: {}, parts: null } : null;
}

export function backupFilename(label?: string): string {
  return label ? `microwins-${label}-${todayISO()}.json` : `microwins-${todayISO()}.json`;
}

/**
 * Kam má záloha jít.
 *
 * - `share`: systémové sdílení - Disk, mail, Messenger, cokoli. Soubor odletí
 *   z telefonu, ale uživatel musí vybrat cíl.
 * - `save`: rovnou do Dokumentů. Nic se nikam neposílá, záloha zůstane
 *   v telefonu - dobré, když člověk jen chce soubor a vyřídí si ho potom.
 *
 * Obojí zapisuje ten samý soubor, liší se jen doručení. Volba je na
 * uživateli, protože každý způsob selhává jinak: sdílení nemusí mít kam,
 * ukládání může narazit na práva.
 */
export type ExportTarget = "share" | "save";

/** Co se stalo s exportem - dialog podle toho napíše, kde soubor hledat. */
export type ExportOutcome =
  | { kind: "shared" }
  | { kind: "saved"; path: string; name: string }
  | { kind: "downloaded" }
  /** Uživatel zavřel systémové sdílení - není to chyba, jen se nic nestalo. */
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

/** Zavřené sdílení hlásí plugin jako chybu - od skutečné chyby ho odliší text. */
function isCancelled(e: unknown): boolean {
  return /cancel/i.test(String(e));
}

/**
 * Export zálohy.
 *
 * V prohlížeči stáhne soubor odkazem - `target` se tam neuplatní, prohlížeč
 * jiné doručení nemá. V nativní appce odkaz nefunguje, takže soubor jde buď
 * do sdílení, nebo do Dokumentů podle toho, co si uživatel vybral.
 */
export async function exportBackup(
  state: MicroWinsState,
  target: ExportTarget = "share",
  options: BackupOptions = {},
): Promise<ExportOutcome> {
  const json = serializeBackup(state, options);
  const name = backupFilename(options.label);

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

  if (target === "save") {
    try {
      const saved = await Filesystem.writeFile({
        path: name,
        data: json,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return { kind: "saved", path: saved.uri, name };
    } catch (e) {
      return { kind: "failed", message: String(e) };
    }
  }

  // Sdílení potřebuje soubor na disku - do Cache, ať se neplete mezi zálohy,
  // které si uživatel schválně uložil.
  let uri: string;
  try {
    const written = await Filesystem.writeFile({
      path: name,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    uri = written.uri;
  } catch (e) {
    return { kind: "failed", message: String(e) };
  }

  try {
    await Share.share({ title: "Záloha MicroWins", text: name, url: uri });
    return { kind: "shared" };
  } catch (e) {
    return isCancelled(e) ? { kind: "cancelled" } : { kind: "failed", message: String(e) };
  }
}
