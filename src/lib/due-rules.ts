import { DAY_NAMES, toISODate } from "./date";
import type { ISODate } from "./types";

/**
 * Rychlé termíny - tlačítka „Za hodinu", „Zítra ráno", „Nejbližší sobota".
 *
 * Tlačítko není napevno napsaný text, ale **pravidlo**, které se teprve při
 * otevření přepočítá na konkrétní den a hodinu. Jinak by nešlo splnit dvě věci
 * naráz: přenastavit, co která nabídka znamená (ráno v devět nebo v šest),
 * a přidat si vlastní.
 *
 * Druhy pravidel jsou schválně jen tři a pokrývají všechno, co dává smysl:
 *
 * | druh      | co dělá                       | příklad                  |
 * |-----------|-------------------------------|--------------------------|
 * | `offset`  | za N minut od teď             | Za hodinu                |
 * | `day`     | za N dní v HH:MM (0 = dnes)   | Dnes večer, Zítra ráno   |
 * | `weekday` | nejbližší <den> v HH:MM       | V sobotu v 8:00          |
 *
 * Čisté funkce, žádný React ani localStorage - viz due-rules.test.ts.
 */

export type DueRuleKind = "offset" | "day" | "weekday";

export interface DueRule {
  id: string;
  /** Co je na tlačítku vidět velké. */
  label: string;
  kind: DueRuleKind;
  /** `offset`: kolik minut od teď. */
  minutes: number;
  /** `day`: za kolik dní. 0 = dnes, 1 = zítra. */
  days: number;
  /** `weekday`: 0 = neděle … 6 = sobota, stejně jako `Date.getDay()`. */
  weekday: number;
  /** Hodina "HH:MM"; `null` = celý den. U `offset` se neuplatní. */
  time: string | null;
}

export const DUE_RULE_KINDS: { id: DueRuleKind; label: string; hint: string }[] = [
  { id: "offset", label: "Za chvíli", hint: "odpočítá se od teď" },
  { id: "day", label: "Za N dní", hint: "dnes, zítra, pozítří… v danou hodinu" },
  { id: "weekday", label: "Nejbližší den v týdnu", hint: "hledá se dopředu od dneška" },
];

export const DUE_RULE_MAX = 8;
export const DUE_RULE_LABEL_MAX = 24;

/**
 * Výchozí nabídka. Drží se toho, co se do seznamu na dnešek píše nejčastěji;
 * cokoliv dalšího si uživatel přidá v Nastavení.
 */
export const DEFAULT_DUE_RULES: DueRule[] = [
  { id: "hour", label: "Za hodinu", kind: "offset", minutes: 60, days: 0, weekday: 6, time: null },
  { id: "evening", label: "Dnes večer", kind: "day", minutes: 60, days: 0, weekday: 6, time: "18:00" },
  { id: "tomorrow", label: "Zítra ráno", kind: "day", minutes: 60, days: 1, weekday: 6, time: "09:00" },
  { id: "today", label: "Dnes, bez hodiny", kind: "day", minutes: 60, days: 0, weekday: 6, time: null },
];

export function isValidRuleTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Pravidlo z uložených dat nebo ze zálohy. Co nedává smysl, spadne na výchozí. */
export function parseDueRule(raw: unknown, index: number): DueRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const kind = DUE_RULE_KINDS.some((k) => k.id === record.kind)
    ? (record.kind as DueRuleKind)
    : null;
  if (!kind) return null;
  const label = typeof record.label === "string" ? record.label.trim().slice(0, DUE_RULE_LABEL_MAX) : "";
  if (!label) return null;

  return {
    id: typeof record.id === "string" && record.id ? record.id : `rule_${index}`,
    label,
    kind,
    minutes: clamp(record.minutes as number, 1, 7 * 24 * 60, 60),
    days: clamp(record.days as number, 0, 365, 0),
    weekday: clamp(record.weekday as number, 0, 6, 6),
    time:
      typeof record.time === "string" && isValidRuleTime(record.time) ? record.time : null,
  };
}

/**
 * Seznam pravidel. Prázdný nebo úplně rozbitý spadne na výchozí nabídku -
 * dialog bez jediného tlačítka by vypadal jako chyba. Smazat všechna
 * tlačítka schválně ale jde: prázdné pole se pozná podle toho, že v datech
 * **je**, jen nemá platnou položku… což od výchozího stavu nerozeznáme, takže
 * se v takovém případě vrací výchozí. Kdo je nechce, vypne si celé ToDo.
 */
export function parseDueRules(raw: unknown): DueRule[] {
  if (!Array.isArray(raw)) return DEFAULT_DUE_RULES;
  const out: DueRule[] = [];
  raw.forEach((item, index) => {
    const rule = parseDueRule(item, index);
    if (rule && out.length < DUE_RULE_MAX) out.push(rule);
  });
  return out.length > 0 ? out : DEFAULT_DUE_RULES;
}

export interface ResolvedDue {
  date: ISODate;
  time: string | null;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Pravidlo na konkrétní den a hodinu.
 *
 * U `weekday` je celý vtip v tom, co znamená „nejbližší": **dnešek se počítá**,
 * dokud daná hodina ještě nebyla. V sobotu v sedm ráno tedy „V sobotu v 8:00"
 * míří na dnešek, o dvě hodiny později už na sobotu za týden. Kdyby se dnešek
 * nepočítal nikdy, byla by nabídka v ten jediný den, kdy se hodí nejvíc,
 * k ničemu; kdyby se počítal vždycky, vyrobila by termín v minulosti.
 */
export function resolveDueRule(rule: DueRule, now: Date = new Date()): ResolvedDue {
  if (rule.kind === "offset") {
    const at = new Date(now.getTime() + Math.max(1, rule.minutes) * 60_000);
    return { date: toISODate(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
  }

  if (rule.kind === "day") {
    const at = new Date(now.getTime());
    at.setDate(at.getDate() + Math.max(0, rule.days));
    return { date: toISODate(at), time: rule.time };
  }

  const at = new Date(now.getTime());
  let shift = (rule.weekday - at.getDay() + 7) % 7;
  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  // Dnešek platí jen do zadané hodiny; bez hodiny platí celý den.
  if (shift === 0 && rule.time !== null && minutesOf(rule.time) <= nowMinutes) shift = 7;
  at.setDate(at.getDate() + shift);
  return { date: toISODate(at), time: rule.time };
}

/** Popis pravidla do nastavení: "nejbližší sobota v 8:00". */
export function describeDueRule(rule: DueRule): string {
  if (rule.kind === "offset") {
    const h = Math.floor(rule.minutes / 60);
    const m = rule.minutes % 60;
    const length = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
    return `za ${length} od teď`;
  }
  const at = rule.time ? ` v ${stripZero(rule.time)}` : ", bez hodiny";
  if (rule.kind === "weekday") return `nejbližší ${DAY_NAMES[rule.weekday]}${at}`;
  if (rule.days === 0) return `dnes${at}`;
  if (rule.days === 1) return `zítra${at}`;
  return `za ${rule.days} dní${at}`;
}

function stripZero(time: string): string {
  return time.startsWith("0") ? time.slice(1) : time;
}

/** Nové pravidlo do nastavení - předvyplněné tak, aby dávalo smysl hned. */
export function blankDueRule(id: string): DueRule {
  return { id, label: "V sobotu ráno", kind: "weekday", minutes: 60, days: 0, weekday: 6, time: "08:00" };
}
