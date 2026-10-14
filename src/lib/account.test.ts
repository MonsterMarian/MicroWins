import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_EXISTS,
  describeAuthError,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  parseCredentials,
  parseIdentity,
  storedUser,
  WRONG_PASSWORD,
} from "./account";

describe("adresa", () => {
  it("se očistí od mezer a velkých písmen - jinak by vznikly dva účty", () => {
    expect(normalizeEmail("  Jan.Novak@Seznam.CZ ")).toBe("jan.novak@seznam.cz");
  });

  it("pozná zjevné překlepy", () => {
    expect(isValidEmail("jan@seznam.cz")).toBe(true);
    expect(isValidEmail(" Jan@Seznam.cz ")).toBe(true);
    expect(isValidEmail("jan@seznam")).toBe(false);
    expect(isValidEmail("jan seznam.cz")).toBe(false);
    expect(isValidEmail("jan@@seznam.cz")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("heslo", () => {
  it("musí mít aspoň šest znaků, jak to chce Supabase", () => {
    expect(isValidPassword("12345")).toBe(false);
    expect(isValidPassword("123456")).toBe(true);
  });

  /* Heslo se neořezává: mezera na konci je jeho součást, a kdyby ji appka
     při registraci zahodila a při přihlášení ne, člověk by se nedostal dovnitř. */
  it("mezery se počítají", () => {
    expect(isValidPassword("     x")).toBe(true);
  });
});

describe("chyby přihlášení česky", () => {
  it("špatné heslo nebo e-mail", () => {
    expect(describeAuthError({ code: "invalid_credentials", status: 400 }).message).toBe(
      WRONG_PASSWORD,
    );
    expect(describeAuthError({ message: "Invalid login credentials", status: 400 }).message).toBe(
      WRONG_PASSWORD,
    );
  });

  it("účet, který už existuje", () => {
    expect(describeAuthError({ code: "user_already_exists", status: 422 }).message).toBe(
      ACCOUNT_EXISTS,
    );
    expect(describeAuthError({ message: "User already registered", status: 422 }).message).toBe(
      ACCOUNT_EXISTS,
    );
  });

  it("slabé heslo", () => {
    expect(describeAuthError({ code: "weak_password", status: 422 }).message).toMatch(/slabé/);
  });

  /* Kdyby v Supabase zůstalo zapnuté potvrzování e-mailu, registrace by
     visela na mailu, který nikdo nepošle. Hláška řekne, co přepnout. */
  it("nepotvrzený účet ukáže na nastavení databáze", () => {
    expect(describeAuthError({ code: "email_not_confirmed", status: 400 }).message).toMatch(
      /Confirm email/,
    );
  });

  it("omezení počtu pokusů vytáhne počet sekund", () => {
    const res = describeAuthError({
      code: "over_request_rate_limit",
      status: 429,
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    expect(res.retryIn).toBe(42);
    expect(res.message).toMatch(/42 s/);
    expect(describeAuthError({ status: 429, message: "Too many requests" }).message).toMatch(
      /Moc pokusů/,
    );
  });

  it("vypnuté zakládání účtů", () => {
    expect(describeAuthError({ code: "signup_disabled", status: 422 }).message).toMatch(/vypnuté/);
  });

  it("výpadek sítě", () => {
    expect(describeAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }).message).toMatch(
      /připojení/,
    );
    expect(describeAuthError(new TypeError("Failed to fetch")).message).toMatch(/připojení/);
  });

  it("neznámá chyba se neztratí, jen se zkrátí", () => {
    expect(describeAuthError({ message: "Something odd" }).message).toBe("Something odd");
    expect(describeAuthError(null).message).toMatch(/nepovedlo/);
  });
});

describe("uložené přihlášení bez sítě", () => {
  const withStorage = (value: string | null) => {
    vi.stubGlobal("window", { localStorage: { getItem: () => value } });
  };
  afterEach(() => vi.unstubAllGlobals());

  /* Bez signálu se prošlý token neobnoví, ale Supabase přihlášení v úložišti
     nechá - appka podle něj jede dál offline, místo aby chtěla přihlásit. */
  it("vezme uživatele z uloženého přihlášení", () => {
    withStorage(JSON.stringify({ access_token: "x", user: { id: "u1", email: "a@b.cz" } }));
    expect(storedUser()).toEqual({ id: "u1", email: "a@b.cz" });
  });

  it("bez přihlášení nebo s poškozeným záznamem nic", () => {
    withStorage(null);
    expect(storedUser()).toBeNull();
    withStorage("{nesmysl");
    expect(storedUser()).toBeNull();
    withStorage(JSON.stringify({ user: { email: "a@b.cz" } }));
    expect(storedUser()).toBeNull();
  });
});

describe("zapamatované přihlášení", () => {
  /* Appka nikoho sama neodhlásí - kdo je přihlášený, drží si sama a smaže
     to jen Odhlásit. Poškozený záznam ale nesmí pustit dovnitř „nikoho“. */
  it("přečte, kdo je přihlášený", () => {
    expect(parseIdentity(JSON.stringify({ id: "u1", email: "a@b.cz" }))).toEqual({
      id: "u1",
      email: "a@b.cz",
    });
    expect(parseIdentity(JSON.stringify({ id: "u1" }))).toEqual({ id: "u1", email: "" });
  });

  it("bez záznamu nebo s poškozeným nikdo", () => {
    expect(parseIdentity(null)).toBeNull();
    expect(parseIdentity("{nesmysl")).toBeNull();
    expect(parseIdentity(JSON.stringify({ id: "" }))).toBeNull();
    expect(parseIdentity(JSON.stringify({ email: "a@b.cz" }))).toBeNull();
  });
});

describe("zapamatované přihlašovací údaje", () => {
  /* Synchronizace se po zrušené session přihlásí sama - bez nich by musela
     chtít heslo. Poškozený záznam nesmí poslat do Supabase nesmysl. */
  it("přečte e-mail a heslo", () => {
    expect(parseCredentials(JSON.stringify({ email: "a@b.cz", password: "tajne1" }))).toEqual({
      email: "a@b.cz",
      password: "tajne1",
    });
  });

  it("bez záznamu, s poškozeným nebo neúplným nic", () => {
    expect(parseCredentials(null)).toBeNull();
    expect(parseCredentials("{nesmysl")).toBeNull();
    expect(parseCredentials(JSON.stringify({ email: "a@b.cz" }))).toBeNull();
    expect(parseCredentials(JSON.stringify({ email: "a@b.cz", password: "" }))).toBeNull();
  });
});
