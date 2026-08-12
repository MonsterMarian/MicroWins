import { addDays, diffDays, todayISO, weekEnd, weekStart } from "./date";
import { breadcrumb, nodeById, subtreeIds } from "./domain";
import type {
  ISODate,
  MicroWinsState,
  Microwin,
  PushWin,
  PushWinDifficulty,
  PushWinKind,
  TreeNode,
} from "./types";
import { createId, formatNumber, plural } from "./utils";

/**
 * PushWin - týdenní výzva.
 *
 * Microwin čte laťku z historie zpětně ("dnes to bylo lepší než kdy dřív").
 * PushWin ji staví dopředu ("zkus tohle") a **vždycky z dat uživatele**:
 * kdo dělá dvacet kliků, dostane výzvu na dvacet dva, ne na sto.
 *
 * Celé je to čisté funkce nad stavem. Splnění se proto dá přepočítat kdykoli
 * znovu a nikde se nedrží mezivýsledek, který by se mohl rozejít s daty.
 */

/** Kolik microwinů musí padnout, než se PushWiny vůbec nabídnou. */
export const PUSHWIN_UNLOCK = 50;

/** Po tolika microwinech se odemkne druhé losování v týdnu. */
export const PUSHWIN_SECOND_DRAW = 365;

export const DIFFICULTY_LABEL: Record<PushWinDifficulty, string> = {
  easy: "Lehká",
  medium: "Střední",
  hard: "Těžká",
};

export type Odds = Record<PushWinDifficulty, number>;

export const DEFAULT_ODDS: Odds = { easy: 55, medium: 30, hard: 15 };

// --- stav výzvy -------------------------------------------------------------

export type PushWinStatus = "running" | "done" | "failed";

export function pushWinStatus(push: PushWin, today: ISODate = todayISO()): PushWinStatus {
  if (push.completedAt) return "done";
  return push.week === weekStart(today) ? "running" : "failed";
}

export function activePushWin(
  state: MicroWinsState,
  today: ISODate = todayISO(),
): PushWin | undefined {
  const week = weekStart(today);
  return state.pushWins.find((p) => p.week === week && p.completedAt === null);
}

/** Výzvy tohoto týdne, nejnovější první. */
export function pushWinsOfWeek(state: MicroWinsState, week: ISODate): PushWin[] {
  return state.pushWins
    .filter((p) => p.week === week)
    .sort((a, b) => b.drawnAt.localeCompare(a.drawnAt));
}

/**
 * Kolik losování je v týdnu k dispozici. Jedno vždy, druhé po 365 microwinech -
 * kdo appku používá rok, unese dvě výzvy naráz. Víc ne: z týdenní výzvy by byl
 * druhý seznam úkolů.
 */
export function drawsPerWeek(state: MicroWinsState): number {
  return state.microwins.length >= PUSHWIN_SECOND_DRAW ? 2 : 1;
}

export function isUnlocked(state: MicroWinsState): boolean {
  return state.microwins.length >= PUSHWIN_UNLOCK;
}

export interface DrawAvailability {
  can: boolean;
  /** Kolik losování v tomhle týdnu ještě zbývá. */
  left: number;
  reason: "ok" | "locked" | "running" | "spent";
}

/**
 * Nové losování jde až po dojetí toho předchozího - splněním nebo koncem
 * týdne. Běžící výzva se přelosovat nedá, jinak by se točilo, dokud nepadne
 * něco lehkého.
 */
export function canDraw(state: MicroWinsState, today: ISODate = todayISO()): DrawAvailability {
  const week = weekStart(today);
  const drawn = state.pushWins.filter((p) => p.week === week).length;
  const left = Math.max(0, drawsPerWeek(state) - drawn);

  if (!isUnlocked(state)) return { can: false, left, reason: "locked" };
  if (activePushWin(state, today)) return { can: false, left, reason: "running" };
  if (left === 0) return { can: false, left, reason: "spent" };
  return { can: true, left, reason: "ok" };
}

// --- co se smí použít -------------------------------------------------------

/**
 * Uzly, na které smí výzva cílit.
 *
 * Vynechává odložené složky i všechno pod nimi (`pushExempt`). Strom se
 * nemaže - co člověk přestal dělat, jen odloží - a výzva "zapiš něco v Kurzu
 * fotografování" u odloženého tématu je otrava, ne pobídka.
 */
export function pushableNodes(state: MicroWinsState): TreeNode[] {
  const blocked = new Set<string>();
  for (const node of state.nodes) {
    if (!node.pushExempt) continue;
    for (const id of subtreeIds(state.nodes, node.id)) blocked.add(id);
  }
  return state.nodes.filter((n) => !blocked.has(n.id));
}

/**
 * Microwin, který se počítá do výzvy.
 *
 * Musí za ním stát záznam psaný **v ten den**. Zpětné doplnění je pravda
 * o minulosti, ale výzva je o tom, co člověk udělá teď - jinak by šla splnit
 * dopsáním včerejška.
 */
export function countsForPush(state: MicroWinsState, microwin: Microwin): boolean {
  return state.entries.some(
    (e) => e.metricId === microwin.metricId && e.date === microwin.date && !e.backdated,
  );
}

/** Microwiny v okně výzvy: od losování do konce týdne, bez zpětných zápisů. */
function windowMicrowins(state: MicroWinsState, push: PushWin): Microwin[] {
  const from = push.drawnAt.slice(0, 10);
  const to = weekEnd(push.week);
  const allowed = new Set(pushableNodes(state).map((n) => n.id));
  return state.microwins.filter(
    (m) =>
      m.date >= from &&
      m.date <= to &&
      allowed.has(m.metricId) &&
      countsForPush(state, m) &&
      (push.nodeId === null || inSubtree(state, push.nodeId, m.metricId)),
  );
}

function inSubtree(state: MicroWinsState, rootId: string, nodeId: string): boolean {
  return subtreeIds(state.nodes, rootId).includes(nodeId);
}

// --- laťka ------------------------------------------------------------------

/**
 * Cíl mezi tím, co uživatel běžně dává, a jeho rekordem.
 *
 * - lehká: kus cesty k rekordu, ale pod ním - splnitelné dobrým dnem
 * - střední: rekord překonat o krok
 * - těžká: rekord o desetinu výš
 *
 * Když má někdo záznamy mezi 30 a 40 (typicky 34, rekord 40), vyjde lehká na
 * 38, střední na 41 a těžká na 44. Přesně o tom PushWin je: kousek za hranicí,
 * ne za obzorem.
 */
export function ladder(typical: number, best: number, difficulty: PushWinDifficulty): number {
  const base = Math.max(typical, 0);
  const top = Math.max(best, base);
  if (difficulty === "easy") {
    return Math.max(base + 1, Math.min(top, Math.round(base + (top - base) * 0.6)));
  }
  if (difficulty === "medium") return Math.max(top + 1, base + 2);
  return Math.max(top + Math.max(1, Math.ceil(top * 0.1)), base + 3);
}

/** Prostřední hodnota - odolnější než průměr, který rozhodí jeden výstřel. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- kandidáti --------------------------------------------------------------

export interface Candidate {
  kind: PushWinKind;
  target: number;
  nodeId: string | null;
  text: string;
}

/** Denní počty microwinů za posledních `days` dní (jen dny, kdy něco padlo). */
function dailyCounts(state: MicroWinsState, days: number, today: ISODate): number[] {
  const from = addDays(today, -days);
  const byDate = new Map<ISODate, number>();
  for (const m of state.microwins) {
    if (m.date < from || m.date > today) continue;
    byDate.set(m.date, (byDate.get(m.date) ?? 0) + 1);
  }
  return [...byDate.values()];
}

/** Denní součty metriky - podklad pro rekordní výzvu. */
function dailyTotals(state: MicroWinsState, nodeId: string): number[] {
  const node = nodeById(state.nodes, nodeId);
  const byDate = new Map<ISODate, number>();
  for (const e of state.entries) {
    if (e.metricId !== nodeId) continue;
    const current = byDate.get(e.date);
    const next =
      node?.aggregation === "max" ? Math.max(current ?? 0, e.value) : (current ?? 0) + e.value;
    byDate.set(e.date, next);
  }
  return [...byDate.values()];
}

function weeklySums(state: MicroWinsState, nodeId: string): number[] {
  const byWeek = new Map<ISODate, number>();
  for (const e of state.entries) {
    if (e.metricId !== nodeId) continue;
    const week = weekStart(e.date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + e.value);
  }
  return [...byWeek.values()];
}

/** Kolik různých složek mělo microwin v jednotlivých týdnech. */
function weeklyBreadth(state: MicroWinsState): number[] {
  const byWeek = new Map<ISODate, Set<string>>();
  for (const m of state.microwins) {
    const node = nodeById(state.nodes, m.metricId);
    if (!node) continue;
    const folder = node.parentId ?? m.metricId;
    const week = weekStart(m.date);
    const set = byWeek.get(week) ?? new Set<string>();
    set.add(folder);
    byWeek.set(week, set);
  }
  return [...byWeek.values()].map((s) => s.size);
}

function longestStreak(dates: Set<ISODate>): number {
  const sorted = [...dates].sort();
  let longest = 0;
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of sorted) {
    run = prev !== null && diffDays(prev, d) === 1 ? run + 1 : 1;
    prev = d;
    if (run > longest) longest = run;
  }
  return longest;
}

/**
 * Všechny výzvy, které jde pro daného uživatele a obtížnost vůbec postavit.
 *
 * Generátor musí vybírat z reálných kandidátů, ne z pevného seznamu druhů:
 * kdo nemá jedinou číselnou metriku, nesmí dostat výzvu na rekord.
 */
export function candidates(
  state: MicroWinsState,
  difficulty: PushWinDifficulty,
  today: ISODate = todayISO(),
): Candidate[] {
  const out: Candidate[] = [];
  const allowed = pushableNodes(state);
  const allowedIds = new Set(allowed.map((n) => n.id));
  const liveMicrowins = state.microwins.filter((m) => allowedIds.has(m.metricId));

  // 1. Nádech - X microwinů v jednom dni.
  const counts = dailyCounts(state, 60, today);
  if (counts.length >= 3) {
    const target = Math.max(2, ladder(median(counts), Math.max(...counts), difficulty));
    out.push({
      kind: "burst",
      target,
      nodeId: null,
      text: `${target} ${plural(target, "microwin", "microwiny", "microwinů")} v jednom dni`,
    });
  }

  // 2. Série - X dní po sobě. Do týdne se vejde nejvýš sedm, takže kdo už má
  //    sedmidenní sérii, tenhle druh nedostane - nebylo by kam ho posunout.
  const dates = new Set(liveMicrowins.map((m) => m.date));
  const best = longestStreak(dates);
  if (best >= 2 && best < 7) {
    const target = Math.min(7, ladder(best, best, difficulty));
    if (target > best) {
      out.push({
        kind: "streak",
        target,
        nodeId: null,
        text: `${target} ${plural(target, "den", "dny", "dní")} po sobě aspoň jeden microwin`,
      });
    }
  }

  // 3. Rekord v metrice - dostat denní součet na X.
  for (const node of allowed) {
    if (node.kind !== "metric") continue;
    const totals = dailyTotals(state, node.id);
    if (totals.length < 3) continue;
    const target = ladder(median(totals), Math.max(...totals), difficulty);
    out.push({
      kind: "record",
      target,
      nodeId: node.id,
      text: `${formatNumber(target)}${node.unit ? ` ${node.unit}` : ""} za den: ${node.name}`,
    });
  }

  // 4. Objem - součet metriky za celý týden.
  for (const node of allowed) {
    if (node.kind !== "metric") continue;
    const sums = weeklySums(state, node.id);
    if (sums.length < 3) continue;
    const target = ladder(median(sums), Math.max(...sums), difficulty);
    out.push({
      kind: "volume",
      target,
      nodeId: node.id,
      text: `celkem ${formatNumber(target)}${node.unit ? ` ${node.unit}` : ""} za týden: ${node.name}`,
    });
  }

  // 5. Šířka - microwiny v X různých složkách.
  const breadth = weeklyBreadth(state);
  const folders = new Set(allowed.filter((n) => n.kind === "category").map((n) => n.id));
  if (breadth.length >= 3 && folders.size >= 2) {
    const target = Math.min(
      folders.size,
      Math.max(2, ladder(median(breadth), Math.max(...breadth), difficulty)),
    );
    if (target >= 2) {
      out.push({
        kind: "breadth",
        target,
        nodeId: null,
        text: `microwin ve ${target} různých ${plural(target, "složce", "složkách", "složkách")}`,
      });
    }
  }

  // 6. Návrat - složka, kde je ticho. Obtížnost vybírá, jak dlouhé:
  //    lehká oživí to, co utichlo nedávno, těžká to nejzapomenutější.
  const quiet = allowed
    .filter((n) => n.kind === "category")
    .map((folder) => {
      const ids = new Set(subtreeIds(state.nodes, folder.id));
      const last = liveMicrowins
        .filter((m) => ids.has(m.metricId))
        .reduce<ISODate | null>((acc, m) => (!acc || m.date > acc ? m.date : acc), null);
      return { folder, silence: last ? diffDays(last, today) : Infinity, hasHistory: last !== null };
    })
    .filter((x) => x.hasHistory && x.silence >= 14)
    .sort((a, b) => a.silence - b.silence);

  if (quiet.length > 0) {
    const pick =
      difficulty === "easy"
        ? quiet[0]
        : difficulty === "hard"
          ? quiet[quiet.length - 1]
          : quiet[Math.floor(quiet.length / 2)];
    out.push({
      kind: "revive",
      target: 1,
      nodeId: pick.folder.id,
      text: `microwin ve složce ${pick.folder.name} (${pick.silence} dní ticho)`,
    });
  }

  return out;
}

// --- losování ---------------------------------------------------------------

/** Obtížnost podle nastavených šancí. `roll` je 0-1, aby šlo losování otestovat. */
export function rollDifficulty(odds: Odds, roll: number): PushWinDifficulty {
  const total = odds.easy + odds.medium + odds.hard;
  if (total <= 0) return "easy";
  const point = roll * total;
  if (point < odds.easy) return "easy";
  if (point < odds.easy + odds.medium) return "medium";
  return "hard";
}

export interface DrawResult {
  state: MicroWinsState;
  pushWin: PushWin | null;
}

/**
 * Vylosuje výzvu. `rolls` jsou dvě čísla 0-1 (obtížnost, druh) - test si je
 * dodá sám, appka je bere z `Math.random`.
 *
 * Když pro danou obtížnost není z čeho stavět, sáhne se po lehčí. Nic
 * nevylosovat je lepší než vylosovat nesplnitelné, ale ještě lepší je
 * nabídnout aspoň něco.
 */
export function drawPushWin(
  state: MicroWinsState,
  odds: Odds,
  today: ISODate = todayISO(),
  rolls: [number, number] = [Math.random(), Math.random()],
): DrawResult {
  if (!canDraw(state, today).can) return { state, pushWin: null };

  const wanted = rollDifficulty(odds, rolls[0]);
  const order: PushWinDifficulty[] =
    wanted === "hard" ? ["hard", "medium", "easy"] : wanted === "medium" ? ["medium", "easy"] : ["easy"];

  for (const difficulty of order) {
    const pool = candidates(state, difficulty, today);
    if (pool.length === 0) continue;
    const pick = pool[Math.min(pool.length - 1, Math.floor(rolls[1] * pool.length))];
    const pushWin: PushWin = {
      id: createId("psh"),
      week: weekStart(today),
      kind: pick.kind,
      difficulty,
      target: pick.target,
      nodeId: pick.nodeId,
      text: pick.text,
      drawnAt: `${today}T00:00:00.000Z`,
      completedAt: null,
      microwinIds: [],
    };
    return { state: { ...state, pushWins: [...state.pushWins, pushWin] }, pushWin };
  }

  return { state, pushWin: null };
}

// --- vyhodnocení ------------------------------------------------------------

export interface PushProgress {
  /** Kolik už je splněno (microwinů, dní, kliků). */
  current: number;
  target: number;
  done: boolean;
  /** Microwiny, které se do výzvy počítají. */
  microwinIds: string[];
}

export function evaluatePushWin(state: MicroWinsState, push: PushWin): PushProgress {
  const pool = windowMicrowins(state, push);
  const from = push.drawnAt.slice(0, 10);
  const to = weekEnd(push.week);

  if (push.kind === "burst") {
    const byDate = new Map<ISODate, Microwin[]>();
    for (const m of pool) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
    let bestDay: Microwin[] = [];
    for (const group of byDate.values()) if (group.length > bestDay.length) bestDay = group;
    return finish(bestDay.length, push.target, bestDay);
  }

  if (push.kind === "streak") {
    const dates = [...new Set(pool.map((m) => m.date))].sort();
    let run: ISODate[] = [];
    let bestRun: ISODate[] = [];
    for (const d of dates) {
      run = run.length && diffDays(run[run.length - 1], d) === 1 ? [...run, d] : [d];
      if (run.length > bestRun.length) bestRun = run;
    }
    const inRun = new Set(bestRun);
    return finish(bestRun.length, push.target, pool.filter((m) => inRun.has(m.date)));
  }

  if (push.kind === "breadth") {
    const byFolder = new Map<string, Microwin[]>();
    for (const m of pool) {
      const node = nodeById(state.nodes, m.metricId);
      const folder = node?.parentId ?? m.metricId;
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), m]);
    }
    const used = [...byFolder.values()].flatMap((g) => g.slice(0, 1));
    return finish(byFolder.size, push.target, used);
  }

  if (push.kind === "revive") {
    return finish(Math.min(1, pool.length), push.target, pool.slice(0, 1));
  }

  // record / volume počítají ze záznamů, ne z microwinů - výzva může chtít
  // číslo, které rekord nepřekoná, a přesto je to výkon navíc.
  const entries = state.entries.filter(
    (e) => e.metricId === push.nodeId && e.date >= from && e.date <= to && !e.backdated,
  );

  if (push.kind === "volume") {
    const sum = entries.reduce((s, e) => s + e.value, 0);
    return finish(sum, push.target, pool);
  }

  const node = push.nodeId ? nodeById(state.nodes, push.nodeId) : undefined;
  const byDate = new Map<ISODate, number>();
  for (const e of entries) {
    const current = byDate.get(e.date);
    const next =
      node?.aggregation === "max" ? Math.max(current ?? 0, e.value) : (current ?? 0) + e.value;
    byDate.set(e.date, next);
  }
  const bestDay = Math.max(0, ...byDate.values());
  return finish(bestDay, push.target, pool);
}

function finish(current: number, target: number, microwins: Microwin[]): PushProgress {
  return {
    current,
    target,
    done: current >= target,
    microwinIds: microwins.map((m) => m.id),
  };
}

/**
 * Dopočítá splnění všech běžících výzev. Volá se po každém zápisu i při startu
 * appky - je to čistá funkce, takže se dá pustit kolikrát chce a nic nezkazí.
 *
 * Zároveň uklízí po smazaném stromu: výzva na uzel, který zmizel, se **tiše
 * ruší**, ne označuje za propadlou. Za smazání složky se nemá trestat.
 */
export function settlePushWins(
  state: MicroWinsState,
  today: ISODate = todayISO(),
): MicroWinsState {
  let changed = false;
  const next: PushWin[] = [];

  for (const push of state.pushWins) {
    if (push.nodeId && !nodeById(state.nodes, push.nodeId)) {
      changed = true;
      continue; // uzel je pryč, výzva zmizí s ním
    }
    if (push.completedAt) {
      next.push(push);
      continue;
    }
    if (pushWinStatus(push, today) === "failed") {
      next.push(push);
      continue;
    }

    const progress = evaluatePushWin(state, push);
    if (progress.done) {
      changed = true;
      next.push({
        ...push,
        completedAt: new Date().toISOString(),
        microwinIds: progress.microwinIds,
      });
      continue;
    }
    next.push(push);
  }

  return changed ? { ...state, pushWins: next } : state;
}

// --- popisky ----------------------------------------------------------------

export const KIND_LABEL: Record<PushWinKind, string> = {
  burst: "Nádech",
  streak: "Série",
  record: "Rekord",
  volume: "Objem",
  breadth: "Šířka",
  revive: "Návrat",
};

/** Kde výzva sedí ve stromu - do detailu, aby bylo jasné, čeho se týká. */
export function pushWinPath(state: MicroWinsState, push: PushWin): string {
  if (!push.nodeId) return "napříč stromem";
  const node = nodeById(state.nodes, push.nodeId);
  if (!node) return "smazaný uzel";
  const crumb = breadcrumb(state.nodes, push.nodeId);
  return crumb ? `${crumb} / ${node.name}` : node.name;
}
