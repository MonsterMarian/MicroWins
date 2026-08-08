/**
 * Zabalí statický export do jednoho JSON souboru pro živé aktualizace.
 *
 * Proč JSON a ne ZIP: v balíku nejsou žádné binární soubory, takže rozbalování
 * v telefonu odpadá i s knihovnou na zip. Jeden soubor, jedno stažení,
 * čitelné okem.
 *
 * Spuštění: npm run ota:bundle   (po npm run build)
 * Výstup:   ota/bundle-<verze>.json + ota/latest.json
 */
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const SRC = "out";
const DEST = "ota";

const version = new Date()
  .toISOString()
  .replace(/[-:T]/g, ".")
  .slice(0, 16); // 2026.08.08.22.15

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

const paths = await walk(SRC);
const files = [];
let bytes = 0;

for (const rel of paths) {
  const content = await readFile(path.join(SRC, rel), "utf8");
  bytes += Buffer.byteLength(content);
  files.push({ path: rel, content });
}

if (!files.some((f) => f.path === "index.html")) {
  console.error("V out/ chybí index.html - spusť nejdřív npm run build.");
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });

const bundleName = `bundle-${version}.json`;
await writeFile(path.join(DEST, bundleName), JSON.stringify(files));
await writeFile(
  path.join(DEST, "latest.json"),
  JSON.stringify({ version, bundle: bundleName, notes: "" }, null, 2),
);

console.log(`Balík ${bundleName}: ${files.length} souborů, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`Manifest ota/latest.json, verze ${version}`);
