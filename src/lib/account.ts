import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Uživatelský účet - e-mail a heslo (návrh v DATABAZE.md).
 *
 * Účet je volitelný: kdo se nepřihlásí, má appku přesně jako dřív. Proto se
 * knihovna Supabase načítá až ve chvíli, kdy je potřeba (`import()`), stejně
 * jako SDK k AI - v balíku neleží nikomu, kdo účet nepoužívá, a appka bez
 * uloženého přihlášení ji při startu vůbec nesahá.
 *
 * Žádné e-maily se neposílají: účet vznikne rovnou z adresy a hesla, bez
 * potvrzování. V Supabase musí být proto vypnuté "Confirm email" - jinak by
 * registrace skončila na čekání na mail, který nikdo nepošle (viz `signUp`).
 * Daň za to: zapomenuté heslo si člověk sám neobnoví, obnova chodí mailem.
 *
 * Synchronizace dat zatím není - přihlášení nic nenahrává ani nestahuje.
 * Převzetí dat z telefonu do účtu je připravené v `account-merge.ts`.
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

/** Kde si Supabase drží přihlášení. Do zálohy nepatří a nechodí tam. */
export const AUTH_STORAGE_KEY = "microwins:auth";

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

function client(): Promise<SupabaseClient> {
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
      publish(
        session?.user
          ? { status: "signed-in", email: session.user.email ?? "", userId: session.user.id }
          : { status: "signed-out" },
      );
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

let started = false;

/**
 * Zjistí, jestli je někdo přihlášený. Bez uloženého přihlášení se knihovna
 * vůbec nenačítá - odpověď je "odhlášeno" a hotovo.
 */
export function initAccount(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!accountsEnabled()) return publish({ status: "off" });
  if (!hasStoredSession()) return publish({ status: "signed-out" });

  void client()
    .then((supabase) => supabase.auth.getSession())
    .then(({ data }) => {
      const user = data.session?.user;
      publish(
        user
          ? { status: "signed-in", email: user.email ?? "", userId: user.id }
          : { status: "signed-out" },
      );
    })
    .catch(() => publish({ status: "signed-out" }));
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
    const supabase = await client();
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
    const supabase = await client();
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
  if (user) publish({ status: "signed-in", email: user.email ?? "", userId: user.id });
}

/**
 * Odhlášení. Data v telefonu zůstávají - patří dál tomu, kdo je tu měl.
 * Když server nejde zastihnout, odhlásí se aspoň tohle zařízení.
 */
export async function signOut(): Promise<void> {
  if (!accountsEnabled()) return;
  try {
    const supabase = await client();
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
