import { describe, expect, it } from "vitest";
import {
  buildGeminiRequest,
  errorMessage,
  MAX_SUGGESTIONS,
  parseSuggestions,
  SUGGESTION_MAX_LENGTH,
} from "./ai";

describe("návrhy z odpovědi modelu", () => {
  it("vezme pole rovnou", () => {
    expect(
      parseSuggestions([
        { kind: "priority", text: "Zavolat do banky" },
        { kind: "block", text: "Projít maily" },
      ]),
    ).toEqual([
      { kind: "priority", text: "Zavolat do banky" },
      { kind: "block", text: "Projít maily" },
    ]);
  });

  it("rozbalí odpověď Claude i s větou kolem pole", () => {
    const claude = {
      content: [
        { type: "thinking", thinking: "..." },
        { type: "text", text: 'Tady jsou návrhy:\n[{"kind":"priority","text":"Dopsat nabídku"}]' },
      ],
    };

    expect(parseSuggestions(claude)).toEqual([{ kind: "priority", text: "Dopsat nabídku" }]);
  });

  it("rozbalí odpověď API i blok kódu kolem JSONu", () => {
    const api = {
      candidates: [
        {
          content: {
            parts: [{ text: '```json\n[{"kind":"block","text":"Koupit kafe"}]\n```' }],
          },
        },
      ],
    };

    expect(parseSuggestions(api)).toEqual([{ kind: "block", text: "Koupit kafe" }]);
  });

  it("neznámý druh spadne na blok a prázdný text vypadne", () => {
    expect(
      parseSuggestions([
        { kind: "cíl", text: "Uklidit stůl" },
        { kind: "block", text: "   " },
        { text: "Bez druhu" },
        "úplný nesmysl",
      ]),
    ).toEqual([
      { kind: "block", text: "Uklidit stůl" },
      { kind: "block", text: "Bez druhu" },
    ]);
  });

  it("stejný návrh dvakrát neprojde a dlouhý se ořízne", () => {
    const long = "a".repeat(200);
    const out = parseSuggestions([
      { kind: "block", text: "Zavolat do banky" },
      { kind: "priority", text: "zavolat DO banky" },
      { kind: "block", text: long },
    ]);

    expect(out).toHaveLength(2);
    expect(out[1].text).toHaveLength(SUGGESTION_MAX_LENGTH);
  });

  it("víc návrhů než se vejde se utne", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "block", text: `krok ${i}` }));

    expect(parseSuggestions(many)).toHaveLength(MAX_SUGGESTIONS);
  });

  it("z nesmyslu nebo prázdna nevznikne nic", () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions("{není json")).toEqual([]);
    expect(parseSuggestions({ candidates: [] })).toEqual([]);
  });
});

describe("požadavek a chyby", () => {
  it("dlouhý brain dump se do požadavku vejde oříznutý", () => {
    const body = buildGeminiRequest("x".repeat(9000)) as {
      contents: { parts: { text: string }[] }[];
    };

    expect(body.contents[0].parts[0].text).toHaveLength(4000);
  });

  it("chyba z API se přeloží do čitelné věty", () => {
    expect(errorMessage(403, { error: { message: "API key not valid" } })).toBe("API key not valid");
    expect(errorMessage(401, null)).toBe("Klíč neplatí nebo nemá práva.");
    expect(errorMessage(404, null)).toBe("Model s tímhle jménem neexistuje.");
    expect(errorMessage(500, null)).toBe("Model vrátil 500.");
    expect(errorMessage(529, null)).toBe("Model je přetížený, zkus to za chvíli.");
  });
});
