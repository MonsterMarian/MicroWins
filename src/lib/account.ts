import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Uživatelský účet - přihlášení kódem z e-mailu (návrh v DATABAZE.md).
 *
 * Účet je volitelný: kdo se nepřihlásí, má appku přesně jako dřív. Proto se
 * knihovna Supabase načítá až ve chvíli, kdy je potřeba (`import()`), stejně
 * jako SDK k AI - v balíku neleží nikomu, kdo účet nepoužívá, a appka bez
 * uloženého přihlášení ji při startu vůbec nesahá.
 *
 * Přihlašuje se **kódem**, ne odkazem v mailu: odkaz by musel otevřít appku,
 * a to je nativní nastavení (deep link) = nové APK, které přes to staré nejde
 * nainstalovat. Kód se opíše a nativní část zůstane, jak je.
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
export const SUPABASE_URL = "";
export const SUPABASE_KEY = "";

/** Kde si Supabase drží přihlášení. Do zálohy nepatří a nechodí tam. */
export const AUTH_STORAGE_KEY = "microwins:auth";

/** Kód z e-mailu má šest číslic (Supabase, výchozí délka). */
export const CODE_LENGTH = 6;

/** Nový kód jde pro stejnou adresu vyžádat nejdřív po minutě. */
export const RESEND_SECONDS = 60;

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

/** Pošle na adresu kód. Účet, který ještě neexistuje, se tím založí. */
export async function sendCode(email: string): Promise<AuthResult> {
  if (!accountsEnabled()) return { ok: false, message: NOT_CONNECTED };
  try {
    const supabase = await client();
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: { shouldCreateUser: true },
    });
    return error ? { ok: false, ...describeAuthError(error) } : { ok: true };
  } catch (e) {
    return { ok: false, ...describeAuthError(e) };
  }
}

export async function verifyCode(email: string, code: string): Promise<AuthResult> {
  if (!accountsEnabled()) return { ok: false, message: NOT_CONNECTED };
  try {
    const supabase = await client();
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: normalizeCode(code),
      type: "email",
    });
    if (error) return { ok: false, ...describeAuthError(error) };
    // Stav se přepne i sám přes `onAuthStateChange`; tady kvůli jistotě hned.
    const user = data.session?.user ?? data.user;
    if (user) publish({ status: "signed-in", email: user.email ?? "", userId: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, ...describeAuthError(e) };
  }
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

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Stačí na překlepy - opravdu platnou adresu pozná až doručený kód. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}

/** Z vloženého textu ("123 456", "Kód: 123456") nechá jen číslice. */
export function normalizeCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, CODE_LENGTH);
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
    return { message: `Nový kód půjde poslat za ${retryIn} s.`, retryIn };
  }

  if (code === "otp_expired" || /expired|invalid.*token|token.*invalid/i.test(message)) {
    return { message: "Kód nesedí nebo už vypršel. Zkontroluj ho, nebo si pošli nový." };
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429) {
    return { message: "Moc pokusů za sebou. Zkus to znovu za chvíli." };
  }
  if (code === "email_address_not_authorized") {
    return {
      message:
        "Na tuhle adresu zatím e-maily nechodí - databáze posílá jen členům projektu, dokud nemá vlastní odesílání (SMTP).",
    };
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return { message: "Tahle adresa nevypadá platně." };
  }
  if (code === "signup_disabled" || code === "otp_disabled" || code === "email_provider_disabled") {
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
