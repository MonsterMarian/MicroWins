/**
 * Návrhy z brain dumpu.
 *
 * Appka je jinak čistě offline - tohle je **jediné místo, odkud odchází data
 * ven**, a jen na stisk tlačítka, ne samo od sebe. Odchází jen text brain
 * dumpu, nic jiného.
 *
 * Klíč schválně **nebydlí v `prefs.ts`**: nastavení se celé propisuje do
 * zálohy (`backup.ts`) a záloha se posílá mailem nebo nechává na disku, takže
 * by z ní klíč dřív nebo později vypadl někomu do rukou. Leží proto ve
 * vlastním klíči localStorage, zůstává na jednom zařízení a v záloze není.
 * Do kódu nepatří vůbec - repozitář je veřejný a balík si z něj stahuje
 * kdokoliv.
 */

export type AiProvider = "claude" | "gemini";

export const AI_PROVIDERS: { id: AiProvider; label: string; hint: string }[] = [
  { id: "claude", label: "Claude", hint: "Haiku 4.5 - nejlevnější z řady" },
  { id: "gemini", label: "Gemini", hint: "Flash - občas hlásí přetížení" },
];

/** Nejlevnější model od každého; přepsat se dá v Nastavení. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  claude: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
};

export const DEFAULT_PROVIDER: AiProvider = "claude";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Kolik návrhů si necháme ukázat - víc se na obrazovku nevejde a nikdo je nečte. */
export const MAX_SUGGESTIONS = 6;
export const SUGGESTION_MAX_LENGTH = 80;

const KEY_STORAGE = "microwins:ai-key";
const MODEL_STORAGE = "microwins:ai-model";
const PROVIDER_STORAGE = "microwins:ai-provider";

function readLocal(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/**
 * Změna nastavení AI se ohlásí událostí.
 *
 * Klíč i model bydlí v localStorage mimo `prefs` (do zálohy patřit nesmí),
 * takže se o něm nedozví nic, co kouká na stav appky. Bez ohlášení by se
 * tlačítko Navrhnout objevilo až po vypnutí a zapnutí appky - klíč se zadává
 * v nastavení, tedy v dialogu nad otevřeným listem dne.
 */
export const AI_SETTINGS_EVENT = "microwins:ai-settings";

function writeLocal(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // soukromý režim - volba vydrží do zavření appky
  }
  window.dispatchEvent(new Event(AI_SETTINGS_EVENT));
}

export function isProvider(value: unknown): value is AiProvider {
  return AI_PROVIDERS.some((p) => p.id === value);
}

export function getAiProvider(): AiProvider {
  const stored = readLocal(PROVIDER_STORAGE);
  return isProvider(stored) ? stored : DEFAULT_PROVIDER;
}

export function setAiProvider(provider: AiProvider): void {
  writeLocal(PROVIDER_STORAGE, provider === DEFAULT_PROVIDER ? "" : provider);
}

/** Klíč si drží každý poskytovatel svůj - přepnutí tam a zpět ho nezahodí. */
export function getAiKey(provider: AiProvider = getAiProvider()): string {
  return readLocal(`${KEY_STORAGE}:${provider}`).trim();
}

export function setAiKey(key: string, provider: AiProvider = getAiProvider()): void {
  writeLocal(`${KEY_STORAGE}:${provider}`, key.trim());
}

export function getAiModel(provider: AiProvider = getAiProvider()): string {
  return readLocal(`${MODEL_STORAGE}:${provider}`).trim() || DEFAULT_MODELS[provider];
}

export function setAiModel(model: string, provider: AiProvider = getAiProvider()): void {
  const value = model.trim();
  writeLocal(`${MODEL_STORAGE}:${provider}`, value === DEFAULT_MODELS[provider] ? "" : value);
}

/**
 * `priority` je hlavní věc dne (patří do trojky nahoře), `block` je konkrétní
 * krok, který se dá posadit do půlhodiny v mřížce.
 */
export type SuggestionKind = "priority" | "block";

export interface Suggestion {
  kind: SuggestionKind;
  text: string;
}

export const AI_SYSTEM_PROMPT = `Jsi pomocník v plánovací aplikaci. Dostaneš syrové poznámky (brain dump) jednoho dne.
Vytáhni z nich konkrétní věci k udělání.
Pravidla:
- odpovídej česky, stejným tykáním a tónem jako poznámky;
- "priority" jsou nanejvýš tři hlavní věci dne, "block" je konkrétní krok na půl hodiny;
- text je krátký (do 60 znaků), začíná slovesem v infinitivu ("Zavolat do banky");
- nevymýšlej si nic, co v poznámkách není, a neopakuj tutéž věc dvakrát;
- když v poznámkách žádný úkol není, vrať prázdné pole.
Odpověz **jen** polem JSON, bez uvozovek kolem, ve tvaru:
[{"kind":"priority","text":"…"},{"kind":"block","text":"…"}]`;

/** Tělo požadavku na Gemini. Vlastní funkce kvůli testu. */
export function buildGeminiRequest(text: string): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: text.slice(0, 4000) }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            kind: { type: "STRING", enum: ["priority", "block"] },
            text: { type: "STRING" },
          },
          required: ["kind", "text"],
        },
      },
    },
  };
}

/**
 * Návrhy z odpovědi modelu.
 *
 * Schválně shovívavé: model umí vrátit pole rovnou, zabalit ho do objektu nebo
 * obalit značkami pro blok kódu. Radši zahodit jeden pokřivený návrh než celou
 * odpověď - a co nedává smysl, se zahodí celé.
 */
export function parseSuggestions(raw: unknown): Suggestion[] {
  const list = toArray(raw);
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const text =
      typeof record.text === "string" ? record.text.trim().slice(0, SUGGESTION_MAX_LENGTH) : "";
    if (!text) continue;
    const key = text.toLocaleLowerCase("cs");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: record.kind === "priority" ? "priority" : "block", text });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    // Text v bloku kódu (```json …```) - model to občas přibalí i s ohradou.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    const body = (fenced ? fenced[1] : raw).trim();
    if (!body) return [];
    try {
      return toArray(JSON.parse(body));
    } catch {
      // Holý text s polem někde uvnitř - vyzobnout první hranaté závorky.
      const bracket = /\[[\s\S]*\]/.exec(body);
      if (!bracket) return [];
      try {
        return toArray(JSON.parse(bracket[0]));
      } catch {
        return [];
      }
    }
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    // Odpověď Gemini: candidates[0].content.parts[0].text
    const parts = (
      record.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined
    )?.[0]?.content?.parts;
    if (Array.isArray(parts)) return toArray(parts.map((p) => p.text ?? "").join(""));
    // Odpověď Claude: content[] s bloky typu text
    if (Array.isArray(record.content)) {
      const text = (record.content as { type?: string; text?: string }[])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (text) return toArray(text);
    }
    for (const key of ["suggestions", "items", "data", "result"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/** Čitelná hláška z chybové odpovědi API - jinak by uživatel viděl jen "400". */
export function errorMessage(status: number, body: unknown): string {
  const message =
    typeof body === "object" && body !== null
      ? ((body as { error?: { message?: string } }).error?.message ?? "")
      : "";
  if (status === 401 || status === 403) return message || "Klíč neplatí nebo nemá práva.";
  if (status === 404) return message || "Model s tímhle jménem neexistuje.";
  if (status === 429) return message || "Moc požadavků za sebou, zkus to za chvíli.";
  if (status === 529 || status === 503) return message || "Model je přetížený, zkus to za chvíli.";
  return message || `Model vrátil ${status}.`;
}

export interface SuggestInput {
  text: string;
  key: string;
  provider?: AiProvider;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Pošle brain dump a vrátí návrhy. Chybu hází s hláškou, která se dá ukázat
 * rovnou na obrazovce.
 */
export async function suggestFromBrainDump({
  text,
  key,
  provider = DEFAULT_PROVIDER,
  model = DEFAULT_MODELS[provider],
  signal,
}: SuggestInput): Promise<Suggestion[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (!key) throw new Error("Chybí klíč - přidej ho v Nastavení.");
  return provider === "claude"
    ? askClaude(trimmed, key, model, signal)
    : askGemini(trimmed, key, model, signal);
}

/**
 * Claude přes oficiální SDK. Načítá se až při prvním dotazu (`import()`),
 * takže knihovna neleží v balíku každému, kdo návrhy nepoužívá.
 *
 * `dangerouslyAllowBrowser` je tu na místě: klíč patří uživateli, leží v jeho
 * zařízení a žádný server mezi tím není - appka je offline a nemá kam volání
 * schovat. SDK v tom režimu samo posílá hlavičku pro volání z prohlížeče.
 */
async function askClaude(
  text: string,
  key: string,
  model: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const { default: Anthropic, APIError } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });

  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content: text.slice(0, 4000) }],
      },
      { signal },
    );
    return parseSuggestions(response);
  } catch (e) {
    if (e instanceof APIError) throw new Error(errorMessage(e.status ?? 0, { error: e.error }));
    throw e;
  }
}

async function askGemini(
  text: string,
  key: string,
  model: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const res = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(buildGeminiRequest(text)),
    signal,
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(res.status, body));
  return parseSuggestions(body);
}
