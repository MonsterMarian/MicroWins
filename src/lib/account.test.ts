import { describe, expect, it } from "vitest";
import { describeAuthError, isValidEmail, normalizeCode, normalizeEmail } from "./account";

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

describe("kód z e-mailu", () => {
  it("z vloženého textu nechá jen číslice", () => {
    expect(normalizeCode("Kód: 123 456")).toBe("123456");
    expect(normalizeCode("12-34-56")).toBe("123456");
  });

  it("víc než šest číslic se usekne", () => {
    expect(normalizeCode("1234567890")).toBe("123456");
  });
});

describe("chyby přihlášení česky", () => {
  it("prošlý nebo špatný kód", () => {
    expect(describeAuthError({ code: "otp_expired", status: 403 }).message).toMatch(/nesedí/);
    expect(describeAuthError({ message: "Token has expired or is invalid", status: 403 }).message).toMatch(
      /nesedí/,
    );
  });

  /* Supabase dovolí nový kód jednou za minutu a zbytek čekání napíše do
     anglické věty. Dialog podle čísla odpočítává tlačítko "Poslat znovu". */
  it("čekání na nový kód vytáhne počet sekund", () => {
    const res = describeAuthError({
      code: "over_email_send_rate_limit",
      status: 429,
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    expect(res.retryIn).toBe(42);
    expect(res.message).toBe("Nový kód půjde poslat za 42 s.");
  });

  it("příliš mnoho pokusů bez udaného času", () => {
    expect(describeAuthError({ status: 429, message: "Too many requests" }).message).toMatch(
      /Moc pokusů/,
    );
  });

  /* Bez vlastního SMTP posílá Supabase jen členům týmu projektu - bez
     vysvětlení by to vypadalo jako rozbitá appka. */
  it("adresa, na kterou databáze zatím neposílá", () => {
    expect(describeAuthError({ code: "email_address_not_authorized" }).message).toMatch(/SMTP/);
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
