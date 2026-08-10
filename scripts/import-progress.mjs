/**
 * Převod CSV exportu z aplikace Progress na zálohu MicroWins.
 *
 * Vyrobí soubor, který appka načte přes Nastavení → Data → Obnovit ze souboru
 * (s rozsahem "jen projekty", takže strom winů zůstane, jak je).
 *
 * Spuštění:
 *   node scripts/import-progress.mjs --in <složka s CSV> [--out <soubor.json>]
 *
 * Co se převádí:
 *   projects.csv   -> projekty (ikona z header_emoji, archivace, deadline)
 *   tasks.csv      -> úkoly
 *   subtasks.csv   -> podúkoly (parentId na úkol)
 *   comments.csv   -> dopíší se do popisu úkolu, appka komentáře nemá
 *   attachments    -> jen poznámka v popisu, přílohy appka neumí
 *
 * Skript si na konci sám přepočítá procenta podle pravidel MicroWins a porovná
 * je s hodnotou `achieve` ze zdroje. Když se rozejdou, mapování je špatně
 * a je to hned vidět.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// --- argumenty --------------------------------------------------------------

const args = process.argv.slice(2);
function arg(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
}

const IN_DIR = arg("in", "C:/Users/mvystavel/Downloads/progress");
const OUT_FILE = arg("out", path.join(IN_DIR, "microwins-projekty.json"));

// --- CSV --------------------------------------------------------------------

/**
 * Minimalistický parser CSV podle RFC 4180 - hodnoty v uvozovkách smí
 * obsahovat čárky i odřádkování (popisy projektů je obsahují).
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Řádky CSV na objekty podle hlavičky; prázdné řádky se zahodí. */
async function readTable(file) {
  let text;
  try {
    text = await readFile(path.join(IN_DIR, file), "utf8");
  } catch {
    console.log(`  ${file}: není, přeskakuju`);
    return [];
  }
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// --- pomocníci --------------------------------------------------------------

/**
 * "2026-01-24T07:01:55.882+01:00" -> "2026-01-24".
 *
 * Bere prvních deset znaků, ne přepočet na UTC: datum ve zdroji je místní den
 * a MicroWins s daty pracuje taky jako s místními. Přes UTC by se u zápisů
 * pozdě večer nebo po půlnoci posunul den.
 */
function toDay(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

/** Časová značka na jeden tvar, ať se dá řadit přes localeCompare. */
function toStamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function num(value) {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function bool(value) {
  return String(value).trim().toLowerCase() === "true";
}

/** "1. 1. 2026" pro poznámky v popisu. */
function czDate(day) {
  const [y, m, d] = day.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Pořadí 0..n podle `sort` a data vzniku; 2147483647 znamená "na konec". */
function normalizeOrder(rows) {
  return [...rows]
    .sort((a, b) => num(a.sort) - num(b.sort) || toStamp(a.create_date).localeCompare(toStamp(b.create_date)))
    .map((row, i) => ({ row, order: i }));
}

// --- procenta podle pravidel MicroWins --------------------------------------

function taskPercent(task, byParent) {
  const children = byParent.get(task.id) ?? [];
  if (children.length > 0) {
    const weight = children.reduce((s, c) => s + (c.weight || 1), 0);
    if (weight === 0) return 0;
    return Math.min(
      100,
      children.reduce((s, c) => s + taskPercent(c, byParent) * (c.weight || 1), 0) / weight,
    );
  }
  if (task.target <= 0) return task.current > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (task.current / task.target) * 100));
}

function projectPercent(projectId, tasks) {
  const byParent = new Map();
  for (const t of tasks) {
    const key = t.parentId ?? "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const top = tasks.filter((t) => t.projectId === projectId && t.parentId === null);
  if (top.length === 0) return 0;
  const weight = top.reduce((s, t) => s + (t.weight || 1), 0);
  if (weight === 0) return 0;
  return top.reduce((s, t) => s + taskPercent(t, byParent) * (t.weight || 1), 0) / weight;
}

// --- mapování hodnot úkolu --------------------------------------------------

/**
 * Zdroj drží postup třemi způsoby, MicroWins jen jedním (hodnota / cíl):
 *
 *  - `individual_calc = true`: vlastní čísla, přenesou se 1:1 (145 / 200)
 *  - položka s podúkoly: procenta se stejně počítají z dětí, čísla jsou jen
 *    záloha pro případ, že by podúkoly zmizely
 *  - zaškrtávací položka (achieve 0 nebo 100): 0 / 1 nebo 1 / 1
 *  - ruční procenta (achieve 19): 19 / 100
 */
function mapValues(row, hasChildren) {
  const max = num(row.max_value);
  const value = num(row.individual_value);
  const achieve = Math.min(100, Math.max(0, num(row.achieve)));

  if (bool(row.individual_calc) && max > 0) {
    return { target: max, current: Math.min(value, max) };
  }
  if (hasChildren) return { target: 100, current: achieve };
  if (achieve === 0 || achieve === 100) return { target: 1, current: achieve === 100 ? 1 : 0 };
  return { target: 100, current: achieve };
}

// --- převod -----------------------------------------------------------------

console.log(`Čtu CSV z ${IN_DIR}`);
const [projectRows, taskRows, subtaskRows, commentRows, attachmentRows] = await Promise.all([
  readTable("projects.csv"),
  readTable("tasks.csv"),
  readTable("subtasks.csv"),
  readTable("comments.csv"),
  readTable("attachments.csv"),
]);

const projectIds = new Set(projectRows.map((r) => r.id));
const skipped = [];

// Komentáře a přílohy k úkolu - appka je nemá, ať se aspoň neztratí text.
const notesByTask = new Map();
function addNote(taskId, note) {
  if (!taskId) return;
  if (!notesByTask.has(taskId)) notesByTask.set(taskId, []);
  notesByTask.get(taskId).push(note);
}
for (const c of [...commentRows].sort((a, b) => toStamp(a.create_date).localeCompare(toStamp(b.create_date)))) {
  const target = c.subtask_id || c.task_id;
  addNote(target, `[${czDate(toDay(c.create_date))}] ${c.body.trim()}`);
}
for (const a of attachmentRows) {
  const target = a.subtask_id || a.task_id;
  addNote(target, `[příloha ${czDate(toDay(a.create_date))}] ${a.original_name} - appka přílohy neumí, soubor zůstal v exportu`);
}

function withNotes(id, description) {
  const notes = notesByTask.get(id);
  const base = description.trim();
  if (!notes || notes.length === 0) return base;
  return [base, ...notes].filter(Boolean).join("\n\n");
}

// --- projekty ---------------------------------------------------------------

const projects = normalizeOrder(projectRows).map(({ row, order }) => {
  const start = toDay(row.start_date) || toDay(row.create_date);
  const deadline = toDay(row.due_date) || null;
  return {
    id: row.id,
    name: row.name.trim() || "Bez názvu",
    icon: row.header_emoji.trim() || "📁",
    startDate: start,
    // Deadline před startem by appka odmítla jako nesmysl.
    deadline: deadline && deadline >= start ? deadline : null,
    description: row.description.trim(),
    order,
    createdAt: toStamp(row.create_date),
    archivedAt: bool(row.archived) ? toStamp(row.update_date) : null,
  };
});

// --- úkoly a podúkoly -------------------------------------------------------

const childrenOfTask = new Set(subtaskRows.map((s) => s.task_id));
const tasks = [];

// Pořadí se čísluje uvnitř projektu, ne přes celý export - appka to tak dělá
// taky (`createTask` bere počet sourozenců).
const tasksByProject = new Map();
for (const row of taskRows) {
  if (!projectIds.has(row.project_id)) {
    skipped.push(`úkol "${row.name.trim() || row.id}" bez projektu`);
    continue;
  }
  if (!tasksByProject.has(row.project_id)) tasksByProject.set(row.project_id, []);
  tasksByProject.get(row.project_id).push(row);
}

for (const { row, order } of [...tasksByProject.values()].flatMap((rows) => normalizeOrder(rows))) {
  const { target, current } = mapValues(row, childrenOfTask.has(row.id));
  tasks.push({
    id: row.id,
    projectId: row.project_id,
    parentId: null,
    name: row.name.trim() || "Bez názvu",
    icon: row.header_emoji.trim() || "📝",
    target,
    current,
    unit: undefined,
    step: 1,
    weight: 1,
    dueDate: toDay(row.due_date) || null,
    milestoneId: null,
    description: withNotes(row.id, row.description),
    order,
    createdAt: toStamp(row.create_date),
    completedAt: current >= target ? toStamp(row.update_date) : null,
  });
}

const taskIds = new Set(tasks.map((t) => t.id));

// Podúkoly se řadí v rámci svého rodiče, ne globálně.
const byParentTask = new Map();
for (const row of subtaskRows) {
  if (!byParentTask.has(row.task_id)) byParentTask.set(row.task_id, []);
  byParentTask.get(row.task_id).push(row);
}

for (const [parentId, rows] of byParentTask) {
  if (!taskIds.has(parentId)) {
    for (const row of rows) skipped.push(`podúkol "${row.name.trim()}" bez rodiče`);
    continue;
  }
  const parent = tasks.find((t) => t.id === parentId);
  for (const { row, order } of normalizeOrder(rows)) {
    const { target, current } = mapValues(row, false);
    tasks.push({
      id: row.id,
      projectId: parent.projectId,
      parentId,
      name: row.name.trim() || "Bez názvu",
      icon: "📝",
      target,
      current,
      unit: undefined,
      step: 1,
      weight: 1,
      dueDate: toDay(row.due_date) || null,
      milestoneId: null,
      description: withNotes(row.id, row.description),
      order,
      createdAt: toStamp(row.create_date),
      completedAt: current >= target ? toStamp(row.update_date) : null,
    });
  }
}

// --- otisky postupu ---------------------------------------------------------

/**
 * Zdroj historii postupu neexportuje, takže se vyrobí dva body: nula na startu
 * a skutečný postup ke dni poslední změny. Graf tak nakreslí čáru odtud potud
 * místo aby zůstal prázdný. Nic se tím nepředstírá - mezi tím appka doplní
 * poslední známou hodnotu, jako u ručně vedeného projektu.
 *
 * Ten druhý otisk musí padnout nejpozději na včerejšek. Appka počítá "dnešní
 * přírůstek" jako rozdíl proti včerejšku, takže s otiskem k dnešku by celý
 * přenesený postup vypadal jako práce odvedená v den importu.
 */
const now = new Date();
const TODAY_DAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const yesterday = new Date(now);
yesterday.setDate(yesterday.getDate() - 1);
const YESTERDAY_DAY = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

const snapshots = [];
for (const row of projectRows) {
  const project = projects.find((p) => p.id === row.id);
  const percent = Math.round(projectPercent(project.id, tasks) * 10) / 10;
  const changed = toDay(row.update_date);
  const mark = changed && changed < TODAY_DAY ? changed : YESTERDAY_DAY;

  if (mark > project.startDate) {
    snapshots.push({ projectId: project.id, date: project.startDate, percent: 0 });
    snapshots.push({ projectId: project.id, date: mark, percent });
  } else {
    // Projekt založený dnes nebo včera - jeden bod stačí.
    snapshots.push({ projectId: project.id, date: project.startDate, percent });
  }
}

// --- výstup -----------------------------------------------------------------

const backup = {
  format: "microwins-backup",
  backupVersion: 1,
  stateVersion: 2,
  exportedAt: new Date().toISOString(),
  settings: {},
  state: {
    version: 2,
    nodes: [],
    entries: [],
    microwins: [],
    projects,
    tasks,
    milestones: [],
    snapshots,
  },
};

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(backup, null, 2));

// --- kontrola ---------------------------------------------------------------

console.log(`\nProjekty: ${projects.length}, úkoly: ${tasks.filter((t) => !t.parentId).length}, podúkoly: ${tasks.filter((t) => t.parentId).length}`);
console.log(`Poznámky z komentářů a příloh: ${[...notesByTask.values()].reduce((s, n) => s + n.length, 0)}`);

console.log("\nKontrola procent (zdroj → MicroWins):");
let mismatch = 0;
for (const row of [...projectRows].sort((a, b) => a.name.localeCompare(b.name, "cs"))) {
  const project = projects.find((p) => p.id === row.id);
  const mine = Math.floor(projectPercent(project.id, tasks) + 1e-9);
  const theirs = Math.floor(num(row.achieve));
  const ok = Math.abs(mine - theirs) <= 1;
  if (!ok) mismatch++;
  console.log(
    `  ${ok ? "ok " : "!! "} ${String(theirs).padStart(3)} % → ${String(mine).padStart(3)} %  ${project.icon} ${project.name}${project.archivedAt ? " (archiv)" : ""}`,
  );
}

if (skipped.length > 0) {
  console.log(`\nVynecháno (${skipped.length}), v MicroWins by to nemělo kam patřit:`);
  for (const s of skipped) console.log(`  - ${s}`);
}

const files = await readdir(path.join(IN_DIR, "files")).catch(() => []);
if (files.length > 0) {
  console.log(`\nPřílohy (${files.length}) se nepřenesou, appka je neumí. Zůstávají v ${path.join(IN_DIR, "files")}`);
}

console.log(`\nHotovo: ${OUT_FILE}`);
if (mismatch > 0) {
  console.error(`\nPOZOR: u ${mismatch} projektů nesedí procenta - mapování je špatně.`);
  process.exit(1);
}
