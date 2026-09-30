import { describeAuthError, getAccount, getClient, initAccount, subscribeAccount } from "./account";
import { same } from "./account-merge";
import { serializeBackup } from "./backup";
import {
  DEFAULT_PREFS,
  getPrefs,
  parsePrefs,
  setPrefs,
  subscribePrefs,
  type Prefs,
} from "./prefs";
import { recordId, SETTINGS_KIND, type SyncRecord } from "./sync";
import {
  SyncEngine,
  type AdoptionPlan,
  type OutgoingRow,
  type RemoteRow,
  type SyncMeta,
  type SyncProgress,
  type SyncTransport,
} from "./sync-engine";
import { setTheme, storedTheme, subscribeTheme } from "./theme";
import type { MicroWinsState } from "./types";
import { createId } from "./utils";

/**
 * Synchronizace - skutečné napojení: Supabase, localStorage, StoreProvider
 * a stav pro obrazovku. Pravidla samotná žijí v `sync-engine.ts`.
 *
 * Kdy se synchronizuje: po přihlášení, po startu appky, pár sekund po každé
 * změně, po návratu do appky a každé dvě minuty, dokud je vidět. Bez účtu
 * se nedělá nic - deník se nepíše a knihovna Supabase se ani nenačte.
 */

const META_KEY = "microwins:sync";
const DEVICE_KEY = "microwins:device";
/** Záloha dat zařízení těsně před spojením s účtem - poslední záchrana. */
export const PRE_ACCOUNT_KEY = "microwins:pre-account";

const PAGE = 1000;
const AFTER_CHANGE_MS = 2_000;
const INTERVAL_MS = 120_000;
const FOCUS_THROTTLE_MS = 20_000;

// --- úložiště ---------------------------------------------------------------

const EMPTY_META: SyncMeta = { owner: null, cursor: null, outbox: {} };
let metaCache: SyncMeta | null = null;

function loadMeta(): SyncMeta {
  if (metaCache) return metaCache;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SyncMeta>) : {};
    metaCache = {
      owner: typeof parsed.owner === "string" ? parsed.owner : null,
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      outbox: parsed.outbox && typeof parsed.outbox === "object" ? parsed.outbox : {},
    };
  } catch {
    metaCache = EMPTY_META;
  }
  return metaCache;
}

function saveMeta(meta: SyncMeta): void {
  metaCache = meta;
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // plné úložiště - fronta vydrží aspoň do zavření appky
  }
}

function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = createId("dev");
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "dev_unknown";
  }
}

// --- síť --------------------------------------------------------------------

const transport: SyncTransport = {
  async pull(since, onProgress) {
    const supabase = await getClient();
    const out: RemoteRow[] = [];
    let total: number | null = null;
    for (let from = 0; ; from += PAGE) {
      // Počet stačí zjistit jednou - kvůli pruhu "stahuju 1 000 / 2 400".
      let query = supabase
        .from("records")
        .select("kind,key,data,changed_at,updated_at", from === 0 ? { count: "exact" } : undefined);
      if (since) query = query.gt("updated_at", since);
      const { data, error, count } = await query
        .order("updated_at")
        .order("kind")
        .order("key")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (from === 0) total = count ?? null;
      const rows = (data ?? []) as RemoteRow[];
      out.push(...rows);
      onProgress?.(out.length, total);
      if (rows.length < PAGE) return out;
    }
  },
  async push(rows: OutgoingRow[]) {
    const supabase = await getClient();
    const device_id = deviceId();
    const { error } = await supabase.rpc("push_records", {
      rows: rows.map((r) => ({ ...r, device_id })),
    });
    if (error) throw error;
  },
};

// --- nastavení ---------------------------------------------------------------

/**
 * Nastavení appky jde do účtu po jednotlivých volbách (`settings:accent`,
 * `settings:tabOrder`, `settings:theme` …), ne jako jeden balík. Kdo na
 * telefonu přepne barvu a na tabletu mezitím pořadí záložek, má pak obojí -
 * jako balík by jedna změna přebila druhou.
 *
 * Klíč k AI ani adresa aktualizací v `prefs` nejsou a nesynchronizují se:
 * klíč nemá opustit zařízení, adresu si každé nastavuje samo.
 */
const THEME_SETTING = "theme";
const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof Prefs)[];

function isPrefKey(key: string): key is keyof Prefs {
  return (PREF_KEYS as string[]).includes(key);
}

function settingsRecords(): SyncRecord[] {
  const prefs = getPrefs();
  const out: SyncRecord[] = PREF_KEYS.map((key) => ({ kind: SETTINGS_KIND, key, data: prefs[key] }));
  // Téma se posílá, jen když ho někdo vybral - jinak se řídí systémem zařízení.
  const theme = storedTheme();
  if (theme) out.push({ kind: SETTINGS_KIND, key: THEME_SETTING, data: theme });
  return out;
}

function readSetting(kind: string, key: string): SyncRecord | null {
  if (kind !== SETTINGS_KIND) return null;
  if (key === THEME_SETTING) {
    const theme = storedTheme();
    return theme ? { kind, key, data: theme } : null;
  }
  return isPrefKey(key) ? { kind, key, data: getPrefs()[key] } : null;
}

/**
 * Zařízení spojená s účtem ještě před synchronizací nastavení převzetím
 * prošla, takže jejich nastavení v účtu není - a do fronty by se dostalo až
 * s první změnou nějaké volby. Jednou po aktualizaci se proto podívá, co
 * v účtu je: když nic, pošle tam svoje; když něco, vezme si ho (vyhrává účet,
 * stejně jako při prvním přihlášení). Celé, ne od kurzoru - starší verze
 * appky záznamy nastavení stáhla, neznala je a kurzor posunula za ně.
 */
const SETTINGS_SEEDED_KEY = "microwins:settings-seeded";

async function seedSettingsOnce(userId: string): Promise<void> {
  try {
    if (window.localStorage.getItem(SETTINGS_SEEDED_KEY) === userId) return;
  } catch {
    return;
  }
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("records")
    .select("kind,key,data")
    .eq("kind", SETTINGS_KIND);
  if (error) return; // zkusí se příště
  const rows = (data ?? []) as SyncRecord[];
  if (rows.length === 0) {
    const ids = settingsRecords().map((r) => recordId(r.kind, r.key));
    if (engine.touch(ids) > 0) schedule(0);
  } else {
    // Co se tu mezitím přepnulo a čeká na odeslání, má přednost.
    const pending = loadMeta().outbox;
    applySettings(rows.filter((r) => !(recordId(r.kind, r.key) in pending)));
  }
  try {
    window.localStorage.setItem(SETTINGS_SEEDED_KEY, userId);
  } catch {
    // soukromý režim - zeptá se znovu příště, nic se nerozbije
  }
}

/** Běží propsání ze sítě - změny se pak nesmějí vrátit do deníku. */
let applyingRemote = false;

/**
 * Nastavení z jiného zařízení. Prochází stejnou kontrolou jako záloha
 * (`parsePrefs`), takže nesmysl nebo volba z novější verze appky nic
 * nerozbije - spadne na to, co tu bylo.
 */
function applySettings(records: SyncRecord[]): void {
  const patch: Record<string, unknown> = {};
  let theme: "dark" | "light" | null = null;
  for (const r of records) {
    if (r.kind !== SETTINGS_KIND || r.data === null || r.data === undefined) continue;
    if (r.key === THEME_SETTING) {
      if (r.data === "dark" || r.data === "light") theme = r.data;
    } else if (isPrefKey(r.key)) {
      patch[r.key] = r.data;
    }
  }

  applyingRemote = true;
  try {
    if (Object.keys(patch).length > 0) {
      const current = getPrefs();
      const checked = parsePrefs({ ...current, ...patch });
      const changed = PREF_KEYS.filter((key) => !same(current[key], checked[key]));
      if (changed.length > 0) {
        setPrefs(Object.fromEntries(changed.map((key) => [key, checked[key]])) as Partial<Prefs>);
      }
    }
    if (theme && theme !== storedTheme()) setTheme(theme);
  } finally {
    applyingRemote = false;
  }
}

// --- napojení na stav appky -------------------------------------------------

interface StoreBridge {
  get(): MicroWinsState;
  /** Nahradí stav bez zápisu do deníku. */
  replace(next: MicroWinsState): void;
}

let bridge: StoreBridge | null = null;

const engine = new SyncEngine({
  transport,
  loadMeta,
  saveMeta,
  getState: () => bridge!.get(),
  replaceState: (next) => bridge!.replace(next),
  now: () => new Date(),
  onProgress: (progress) => publish({ progress: progress ?? undefined }),
  extraRecords: settingsRecords,
  readExtra: readSetting,
  applyExtra: applySettings,
});

// --- stav pro obrazovku -----------------------------------------------------

export type SyncPhase =
  /** Nikdo není přihlášený. */
  | "off"
  /** Stahuje se účet a zjišťuje, co s daty v zařízení. */
  | "checking"
  /** Čeká se na rozhodnutí, jak spojit data v zařízení s účtem. */
  | "needs-adoption"
  | "syncing"
  | "idle"
  /** Není spojení - změny počkají. */
  | "offline"
  | "error";

export interface SyncStatus {
  phase: SyncPhase;
  /** Kolik změn čeká na odeslání. */
  pending: number;
  lastSyncAt: string | null;
  message?: string;
  plan?: AdoptionPlan;
  /** Dialog převzetí je otevřený (po "Teď ne" se schová, plán zůstane). */
  asking?: boolean;
  /** Právě běžící přenos - pro pruh nahoře a v Nastavení. */
  progress?: SyncProgress;
}

/** "Nahrávám do účtu 500 / 843" - jedna věta pro pruh i Nastavení. */
export function progressLabel(progress: SyncProgress): string {
  const verb = progress.direction === "up" ? "Nahrávám do účtu" : "Stahuju z účtu";
  if (progress.total === null || progress.total === 0) return `${verb}…`;
  return `${verb} ${Math.min(progress.done, progress.total)} / ${progress.total}`;
}

/** Podíl hotového 0-100; `null` = neví se, kolik zbývá. */
export function progressPercent(progress: SyncProgress): number | null {
  if (!progress.total) return null;
  return Math.min(100, (progress.done / progress.total) * 100);
}

let status: SyncStatus = { phase: "off", pending: 0, lastSyncAt: null };
const listeners = new Set<() => void>();

function publish(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch, pending: engine && bridge ? engine.pending() : status.pending };
  for (const fn of listeners) fn();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

const SERVER_STATUS: SyncStatus = { phase: "off", pending: 0, lastSyncAt: null };
export function getServerSyncStatus(): SyncStatus {
  return SERVER_STATUS;
}

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isOffline(e: unknown): boolean {
  const record = (typeof e === "object" && e !== null ? e : {}) as { name?: unknown; message?: unknown };
  return (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    record.name === "TypeError" ||
    /fetch|network|load failed/i.test(String(record.message ?? ""))
  );
}

function failed(e: unknown): Partial<SyncStatus> {
  return isOffline(e)
    ? { phase: "offline", message: "Bez připojení - změny odejdou, až se to spojí." }
    : { phase: "error", message: describeAuthError(e).message };
}

// --- průběh -----------------------------------------------------------------

function signedInUser(): string | null {
  const account = getAccount();
  return account.status === "signed-in" ? account.userId : null;
}

let running = false;
let again = false;
let timer: number | null = null;

/** Jedno kolo synchronizace. Když už jedno běží, pustí se další hned po něm. */
export async function syncNow(): Promise<void> {
  const user = signedInUser();
  if (!bridge || !user) return;
  if (engine.owner() !== user) {
    /* Data ještě nepatří účtu. Když se kontrola po přihlášení nepovedla
       (bez signálu), zkusí se znovu - jinak by appka čekala do restartu.
       Odložené převzetí ("Teď ne") se ale samo znovu nevnucuje. */
    if (!status.plan && status.phase !== "checking") void onSignedIn(user);
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  publish({ phase: "syncing", message: undefined });
  try {
    await engine.sync();
    publish({ phase: "idle", lastSyncAt: new Date().toISOString(), message: undefined });
    void seedSettingsOnce(user);
  } catch (e) {
    publish(failed(e));
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(0);
    }
  }
}

function schedule(ms: number): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void syncNow();
  }, ms);
}

/** Zavolá StoreProvider při každé změně stavu (ne při té ze synchronizace). */
export function journalCommit(prev: MicroWinsState, next: MicroWinsState): void {
  if (!bridge) return;
  if (engine.journal(prev, next) === 0) return;
  afterLocalChange();
}

function afterLocalChange(): void {
  publish({});
  if (signedInUser()) schedule(AFTER_CHANGE_MS);
}

/**
 * Hlídá změny nastavení a tématu. Porovnává volbu po volbě, takže do fronty
 * jde jen to, na co se sáhlo. Změny ze sítě (`applyingRemote`) se jen
 * zapamatují jako nový výchozí stav.
 */
function watchSettings(): void {
  let lastPrefs = getPrefs();
  let lastTheme = storedTheme();

  subscribePrefs(() => {
    const next = getPrefs();
    const changed = PREF_KEYS.filter((key) => !same(lastPrefs[key], next[key]));
    lastPrefs = next;
    if (applyingRemote || changed.length === 0) return;
    if (engine.touch(changed.map((key) => recordId(SETTINGS_KIND, key))) > 0) afterLocalChange();
  });

  subscribeTheme(() => {
    const next = storedTheme();
    const changed = next !== lastTheme;
    lastTheme = next;
    if (applyingRemote || !changed || !next) return;
    if (engine.touch([recordId(SETTINGS_KIND, THEME_SETTING)]) > 0) afterLocalChange();
  });
}

/** Po přihlášení: synchronizace, nebo nejdřív převzetí dat do účtu. */
async function onSignedIn(userId: string): Promise<void> {
  if (engine.owner() === userId) return syncNow();
  publish({ phase: "checking", message: undefined });
  try {
    const plan = await engine.planAdoption(userId);
    if (signedInUser() !== userId) return;
    if (!plan) return syncNow();
    // Prázdné zařízení se nemá na co ptát - vezme si účet, jak je.
    if (plan.kind === "fresh") {
      await engine.adopt(plan);
      publish({ phase: "idle", lastSyncAt: new Date().toISOString(), plan: undefined });
      return;
    }
    publish({ phase: "needs-adoption", plan, asking: true });
  } catch (e) {
    publish(failed(e));
  }
}

function backupBeforeAdoption(): void {
  try {
    window.localStorage.setItem(PRE_ACCOUNT_KEY, serializeBackup(bridge!.get()));
  } catch {
    // na zálohu nezbylo místo - dialog nabízí i stažení do souboru
  }
}

/**
 * Potvrzené převzetí. `merge` data zařízení spojí s účtem; `account` je
 * zahodí a vezme účet, jak je - pro zařízení se zkušebními daty, nebo pro
 * data jiného účtu. Předtím se data zařízení vždycky odloží stranou.
 */
export async function confirmAdoption(mode: "merge" | "account" = "merge"): Promise<boolean> {
  const plan = status.plan;
  if (!plan || !bridge) return false;
  backupBeforeAdoption();
  publish({ phase: "checking", asking: false });
  try {
    await engine.adopt(
      mode === "account" && plan.kind === "merge"
        ? {
            kind: "fresh",
            userId: plan.userId,
            account: plan.account,
            cursor: plan.cursor,
            extras: plan.extras,
          }
        : plan,
    );
    publish({ phase: "idle", plan: undefined, lastSyncAt: new Date().toISOString() });
    void syncNow();
    return true;
  } catch (e) {
    publish({ ...failed(e), phase: "needs-adoption", plan, asking: true });
    return false;
  }
}

/** "Teď ne" - dialog se schová, v Nastavení → Účet zůstane tlačítko. */
export function postponeAdoption(): void {
  if (status.plan) publish({ asking: false });
}

export function reopenAdoption(): void {
  if (status.plan) publish({ asking: true });
  else {
    const user = signedInUser();
    if (user) void onSignedIn(user);
  }
}

// --- start ------------------------------------------------------------------

let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  initAccount();
  watchSettings();

  let lastUser: string | null = null;
  const onAccount = () => {
    const user = signedInUser();
    if (user === lastUser) return;
    lastUser = user;
    if (user) void onSignedIn(user);
    else publish({ phase: "off", plan: undefined, asking: false, message: undefined });
  };
  subscribeAccount(onAccount);
  onAccount();

  let lastFocus = 0;
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastFocus < FOCUS_THROTTLE_MS) return;
    lastFocus = Date.now();
    void syncNow();
  };
  window.addEventListener("focus", wake);
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", wake);
  window.setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, INTERVAL_MS);
}

/** StoreProvider se připojí po načtení dat - dřív není co synchronizovat. */
export function connectStore(next: StoreBridge): void {
  bridge = next;
  publish({});
  watch();
}
