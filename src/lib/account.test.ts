import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXISTS,
  describeAuthError,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
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
