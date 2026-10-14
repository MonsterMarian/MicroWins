import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Uživatelský účet - e-mail a heslo (návrh v DATABAZE.md).
 *
 * Účet je povinný: data žijí v databázi a appka bez přihlášení ukáže jen
 * přihlášení (`AuthGate`). V telefonu je kopie dat, takže po prvním
 * přihlášení appka jede i bez signálu a synchronizuje se, až se spojí.
 *
 * **Appka nikoho sama neodhlásí** - ani po letech bez signálu. Kdo je
 * přihlášený, si drží sama (`IDENTITY_KEY`), nezávisle na tokenu Supabase;
 * odhlásí jen tlačítko Odhlásit.
 *
 * Synchronizace jede na obnovovacím tokenu Supabase, jak je zvykem u appek
 * offline-first: heslo se zadá jednou a v zařízení se **neukládá**. Token
 * ve výchozím nastavení projektu nevyprší a obnovuje se sám, takže přihlášení
 * vydrží roky. Zrušit ho může jen server (změna hesla, odhlášení všude) -
 * pak appka jede dál, změny čekají v telefonu a Nastavení → Účet nabídne
 * přihlášení (`sessionRevoked`). Žádné okno samo nevyskočí.
 * Knihovna Supabase se načítá až ve chvíli, kdy je potřeba (`import()`).
 *
 * Žádné e-maily se neposílají: účet vznikne rovnou z adresy a hesla, bez
 * potvrzování. V Supabase musí být proto vypnuté "Confirm email" - jinak by
 * registrace skončila na čekání na mail, který nikdo nepošle (viz `signUp`).
 * Daň za to: zapomenuté heslo si člověk sám neobnoví, obnova chodí mailem.
 *
 * Synchronizace a převzetí dat z telefonu do účtu: `sync-runtime.ts`,
 * `account-merge.ts`.
 */

/**
 * Adresa projektu a veřejný klíč ze Supabase (Settings → API Keys, adresa
 * i klíč jsou pohromadě v dialogu Connect). Klíč je `sb_publishable_…`;
 * starý `anon` by fungoval taky, ale Supabase ho do konce roku 2026 ruší.
 *
 * Obojí je veřejné z principu a do repozitáře smí: kdo co vidí, hlídá
 * databáze (Row Level Security, `supabase/schema.sql`). Tajný klíč
 * (`sb_secret_…`, dřív `service_role`) sem **nikdy** - repozitář i balíky
 * živých aktualizací jsou veřejné.
 *
 * Prázdné = účty ještě nejsou napojené; appka to řekne a jede bez nich.
 */
export const SUPABASE_URL: string = "https://mgxbvayypbrrbdzurgcj.supabase.co";
export const SUPABASE_KEY: string = "sb_publishable_ejAce0IsaPlrg8CyrzsePQ_LrDDn4ll";

/** Kde si Supabase drží přihlášení (tokeny). */
export const AUTH_STORAGE_KEY = "microwins:auth";

/**
 * Kdo je v appce přihlášený - zvlášť od tokenů Supabase. Tokeny můžou
 * propadnout nebo je server zahodí; tenhle záznam smaže jen Odhlásit.
 */
export const IDENTITY_KEY = "microwins:account";

/**
 * Heslo, které tu krátce (verze 2026.10.14.09.34) leželo kvůli tichému
 * přihlášení. Hesla se v zařízení neukládají - při startu se smaže.
 */
const OLD_CREDENTIALS_KEY = "microwins:credentials";

/** Nejkratší heslo, které Supabase ve výchozím nastavení vezme. */
export const PASSWORD_MIN = 6;

export function accountsEnabled(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_KEY !== "";
}

export type AccountState =
  /** Appka zatím nemá napojenou databázi. */
  | { status: "off" }
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; email: string; userId: string };

// --- stav pro komponenty ----------------------------------------------------

const LOADING: AccountState = { status: "loading" };
let snapshot: AccountState = LOADING;
const listeners = new Set<() => void>();

function publish(next: AccountState): void {
  snapshot = next;
  for (const fn of listeners) fn();
}

/** Snímek pro `useSyncExternalStore` - drží identitu, dokud se nic nezmění. */
export function getAccount(): AccountState {
  return snapshot;
}

export function getServerAccount(): AccountState {
  return LOADING;
}

export function subscribeAccount(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- klient -----------------------------------------------------------------

let clientPromise: Promise<SupabaseClient> | null = null;

/** Klient Supabase - načte se při prvním použití (přihlášení, synchronizace). */
export function getClient(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // Přihlášení nikdy nechodí přes adresu - kód se opisuje do appky.
        detectSessionInUrl: false,
      },
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        signedInAs({ id: session.user.id, email: session.user.email ?? "" });
        return;
      }
      // Bez session (bez sítě, nebo ji server zahodil) se nic neodhlašuje -
      // appka jede dál a synchronizace se před dalším kolem přihlásí sama
      // (`ensureSession`). Odhlašuje výhradně `signOut`.
    });
    return supabase;
  });
  return clientPromise;
}

function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Uživatel z uloženého přihlášení. Supabase ho v úložišti nechá i tehdy, když
 * se token bez sítě nedá obnovit - a zahodí ho, až když ho odmítne server.
 */
export function storedUser(): { id: string; email: string } | null {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    const user = raw ? (JSON.parse(raw) as { user?: { id?: unknown; email?: unknown } }).user : null;
    return user && typeof user.id === "string"
      ? { id: user.id, email: typeof user.email === "string" ? user.email : "" }
      : null;
  } catch {
    return null;
  }
}

// --- kdo je přihlášený -----------------------------------------------------

export interface Identity {
  id: string;
  email: string;
}

/** Přečte, kdo je v appce přihlášený. Poškozený záznam = nikdo. */
export function parseIdentity(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { id?: unknown; email?: unknown };
    return typeof value.id === "string" && value.id !== ""
      ? { id: value.id, email: typeof value.email === "string" ? value.email : "" }
      : null;
  } catch {
    return null;
  }
}

function loadIdentity(): Identity | null {
  try {
    return parseIdentity(window.localStorage.getItem(IDENTITY_KEY));
  } catch {
    return null;
  }
}

function saveIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // soukromý režim - přihlášení vydrží aspoň do zavření appky
  }
}

/** Přihlášený člověk - zapamatuje se, ať ho appka nikdy sama neodhlásí. */
function signedInAs(identity: Identity): void {
  saveIdentity(identity);
  const current = snapshot;
  if (
    current.status === "signed-in" &&
    current.userId === identity.id &&
    current.email === identity.email
  ) {
    return;
  }
  publish({ status: "signed-in", email: identity.email, userId: identity.id });
}

/**
 * Platná session k synchronizaci, bez ptaní. Prošlý token obnoví Supabase
 * sám z obnovovacího tokenu. `false` = teď to nejde - bez sítě, nebo server
 * přihlášení zrušil (`sessionRevoked`). Appka jede dál, změny počkají.
 */
export async function ensureSession(): Promise<boolean> {
  if (!accountsEnabled() || !hasStoredSession()) return false;
  try {
    const supabase = await getClient();
    const { data } = await supabase.auth.getSession();
    return data.session !== null;
  } catch {
    return false;
  }
}

/**
 * Server přihlášení zrušil: appka si člověka pamatuje, ale Supabase session
 * z úložiště vyhodil (změna hesla, odhlášení všude). Bez sítě session v
 * úložišti zůstává - tehdy to zrušené není, jen se čeká na signál.
 */
export function sessionRevoked(): boolean {
  return getAccount().status === "signed-in" && !hasStoredSession();
}

let started = false;

/**
 * Zjistí, kdo je přihlášený. Odpověď je hned - ze zapamatovaného přihlášení,
 * bez čekání na síť, takže appka naskočí i offline. Knihovna Supabase se
 * načte až potom a jen udržuje token čerstvý.
 *
 * Starší instalace zapamatované přihlášení nemají - vezme se z uložené
 * session Supabase (`storedUser`).
 */
export function initAccount(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!accountsEnabled()) return publish({ status: "off" });
  try {
    window.localStorage.removeItem(OLD_CREDENTIALS_KEY);
  } catch {
    // soukromý režim - nic uloženého není
  }
  const known = loadIdentity() ?? storedUser();
  if (!known) return publish({ status: "signed-out" });
  signedInAs(known);

  if (!hasStoredSession()) return;
  void getClient()
    .then((supabase) => supabase.auth.getSession())
    .then(({ data }) => {
      const user = data.session?.user;
      if (user) signedInAs({ id: user.id, email: user.email ?? "" });
    })
    .catch(() => {
      // bez sítě - přihlášení platí dál, token se obnoví po spojení
    });
}

// --- přihlášení -------------------------------------------------------------

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Za kolik sekund to jde zkusit znovu (u omezení počtu pokusů). */
      retryIn?: number;
    };

/** Přihlášení k účtu, který už existuje. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!accountsEnabled()) return { ok: false, message: NOT_CONNECTED };
  try {
    const supabase = await getClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error) return { ok: false, ...describeAuthError(error) };
    signedIn(data.user);
    return { ok: true };
  } catch (e) {
    return { ok: false, ...describeAuthError(e) };
  }
}

/**
 * Založení účtu. S vypnutým potvrzováním e-mailu vrátí Supabase rovnou
 * přihlášení. Když přihlášení nepřijde, potvrzování v projektu zapnuté
 * zůstalo - účet vznikl, ale bez mailu se do něj nikdo nedostane. Appka to
 * řekne naplno, jinak by to vypadalo, že registrace nefunguje.
 */
export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!accountsEnabled()) return { ok: false, message: NOT_CONNECTED };
  try {
    const supabase = await getClient();
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
    });
    if (error) return { ok: false, ...describeAuthError(error) };
    if (!data.session) {
      return {
        ok: false,
        message:
          "Účet vznikl, ale databáze chce potvrzení e-mailem. V Supabase je potřeba vypnout Confirm email.",
      };
    }
    signedIn(data.user);
    return { ok: true };
  } catch (e) {
    return { ok: false, ...describeAuthError(e) };
  }
}

/** Stav se přepne i sám přes `onAuthStateChange`; tady kvůli jistotě hned. */
function signedIn(user: { id: string; email?: string } | null): void {
  if (user) signedInAs({ id: user.id, email: user.email ?? "" });
}

/**
 * Odhlášení - jediná cesta, jak se z appky dostat ven. Data v telefonu
 * zůstávají - patří dál tomu, kdo je tu měl. Když server nejde zastihnout,
 * odhlásí se aspoň tohle zařízení.
 */
export async function signOut(): Promise<void> {
  if (!accountsEnabled()) return;
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // soukromý režim - nic uloženého není
  }
  try {
    const supabase = await getClient();
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" });
  } catch {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // soukromý režim - přihlášení stejně nepřežije zavření
    }
  }
  publish({ status: "signed-out" });
}

// --- čisté pomocníky (testované) --------------------------------------------

export const NOT_CONNECTED = "Účty zatím nejsou napojené na databázi.";

/** Dialog podle nich nabídne přepnutí na druhou cestu (přihlášení / nový účet). */
export const ACCOUNT_EXISTS = "Účet s tímhle e-mailem už existuje. Přihlas se.";
export const WRONG_PASSWORD = "E-mail nebo heslo nesedí.";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Stačí na překlepy - opravdu platnou adresu pozná až doručený kód. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}

export function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN;
}

/**
 * Chyba ze Supabase jako věta pro člověka. Knihovna posílá `code` (novější
 * servery), `status` a anglický `message`; spolehlivé je hlavně `code`,
 * zbytek je záloha pro starší odpovědi a chyby sítě.
 */
export function describeAuthError(error: unknown): { message: string; retryIn?: number } {
  const e = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : 0;
  const message = typeof e.message === "string" ? e.message : String(error ?? "");

  // "For security purposes, you can only request this after 42 seconds."
  const wait = /after (\d+) seconds?/i.exec(message);
  if (wait) {
    const retryIn = Number(wait[1]);
    return { message: `Moc pokusů za sebou. Zkus to znovu za ${retryIn} s.`, retryIn };
  }

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return { message: WRONG_PASSWORD };
  }
  if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(message)) {
    return { message: ACCOUNT_EXISTS };
  }
  if (code === "weak_password") {
    return { message: `Heslo je moc slabé - aspoň ${PASSWORD_MIN} znaků, klidně víc.` };
  }
  if (code === "email_not_confirmed") {
    return {
      message: "Účet čeká na potvrzení e-mailem. V Supabase je potřeba vypnout Confirm email.",
    };
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return { message: "Moc pokusů za sebou. Zkus to znovu za chvíli." };
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return { message: "Tahle adresa nevypadá platně." };
  }
  if (code === "signup_disabled") {
    return { message: "Zakládání nových účtů je v databázi vypnuté." };
  }
  if (code === "email_provider_disabled") {
    return { message: "Přihlašování e-mailem je v databázi vypnuté." };
  }
  if (
    e.name === "AuthRetryableFetchError" ||
    e.name === "TypeError" ||
    /fetch|network|failed to fetch|load failed/i.test(message)
  ) {
    return { message: "Nejde se spojit. Zkontroluj připojení a zkus to znovu." };
  }
  return { message: message ? message.slice(0, 160) : "Něco se nepovedlo. Zkus to znovu." };
}
