import { mergeState } from "./import";
import { SEED_ID, SEED_STATE } from "./seed-import-data";
import type { MicroWinsState } from "./types";

/**
 * Jednorázová zásilka dat přes živou aktualizaci.
 *
 * Data z jiné aplikace se dají do telefonu dostat souborem, ale jde to i
 * takhle: balík si s sebou přiveze projekty, ty se při prvním spuštění usadí
 * do localStorage a další verze balíku už seed obsahovat nemusí. localStorage
 * patří k adrese `localhost`, kterou výměna souborů nemění, takže projekty
 * zůstanou i po odstranění seedu.
 *
 * Pravidla, aby se to nemohlo zvrtnout:
 *  - použije se **jen jednou**, hlídá to značka v localStorage
 *  - bere se **jen projektová část**, stromu se to nedotkne
 *  - když už stejné projekty v appce jsou, seed se přeskočí (pojistka proti
 *    tomu, že si je uživatel mezitím načetl ze souboru ručně)
 *
 * Až seed doslouží, smaže se tenhle soubor, `seed-import-data.ts` a volání
 * v `store-provider.tsx`.
 */

const SEED_KEY = `microwins:seed:${SEED_ID}`;

function alreadyUsed(): boolean {
  try {
    return localStorage.getItem(SEED_KEY) !== null;
  } catch {
    // Bez localStorage nemá seed kam dosednout, tak se o něj ani nepokoušíme.
    return true;
  }
}

function markUsed(): void {
  try {
    localStorage.setItem(SEED_KEY, new Date().toISOString());
  } catch {
    // Nezapsalo se - horší varianta je, že se seed příště zopakuje, proto
    // je tu ještě kontrola na duplicity níž.
  }
}

/** Stejný název i stejný start = projekt už v appce je. */
function looksImported(state: MicroWinsState): boolean {
  const existing = new Set(state.projects.map((p) => `${p.name}|${p.startDate}`));
  return SEED_STATE.projects.some((p) => existing.has(`${p.name}|${p.startDate}`));
}

export interface SeedResult {
  state: MicroWinsState;
  /** Kolik projektů seed přidal; 0 = nic se nedělo. */
  added: number;
}

export function applySeed(state: MicroWinsState): SeedResult {
  if (SEED_STATE.projects.length === 0) return { state, added: 0 };
  if (alreadyUsed() || looksImported(state)) {
    markUsed();
    return { state, added: 0 };
  }

  const next = mergeState(state, SEED_STATE, "projects", "add");
  markUsed();
  return { state: next, added: SEED_STATE.projects.length };
}
