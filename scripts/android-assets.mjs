import { readdir, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RES = path.join("android", "app", "src", "main", "res");

/**
 * Zdrojem je značka na průhledném pozadí, ne celý obrázek loga.
 *
 * Dřív se sem sypala rovnou vygenerovaná předloha, jenže ta má vlastní
 * pozadí zapečené v pixelech. Popředí adaptivní ikony se pak skládalo
 * s barvou pod ním a v ikoně byl vidět čtvereček dlaždice na jinak barevném
 * podkladu - dvě pozadí přes sebe. Proto se předloha jednou provždy ořízne
 * skriptem `extract-logo-mark.py` na čistou trofej a pozadí si odsud řídí
 * jediná konstanta.
 */
const MARK = "assets/logo_mark.png";

/**
 * Pozadí ikony v launcheru. Trofej je na tuhle modrou nakreslená, tak si ji
 * bere s sebou; je to jediné pozadí, které logu kdo kde podloží.
 */
const BRAND_NAVY = "#0F1745";

/**
 * Pozadí splashe. Schválně jiné než u ikony: splash přechází rovnou do appky
 * a ta má `--background` na téhle barvě (viz `capacitor.config.ts` a
 * `globals.css`). Kdyby byl splash modrý, bliklo by mezi ním a appkou.
 */
const APP_BACKGROUND = "#09090B";

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
  alpha: 1,
});

async function write(file, buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
}

/**
 * Úklid před generováním.
 *
 * Projekt vznikl zkopírováním jiné appky a v `res` po ní zůstaly obrázky
 * v hustotách a variantách, které tenhle skript nepsal - hlavně `-night`
 * a `ldpi`. Android si je vybíral podle tmavého režimu, takže se pod novým
 * logem schovávalo staré: na tmavém telefonu blikl při startu cizí splash
 * a nešlo to poznat, protože soubory měly správná jména.
 *
 * Proto se všechny splashe (a nepoužité ikonové pozadí) nejdřív smažou
 * a teprve pak se napíše kompletní sada. Co skript nevygeneruje, v projektu
 * nezůstane.
 */
async function purgeStale() {
  const dirs = await readdir(RES, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const base = dir.name.split("-")[0];
    if (base === "drawable") {
      await rm(path.join(RES, dir.name, "splash.png"), { force: true });
    }
    if (base === "mipmap") {
      // Adaptivní ikona bere pozadí z `@color/ic_launcher_background`,
      // tyhle PNG nikdo nečte - jen mátly při hledání, odkud se bere logo.
      await rm(path.join(RES, dir.name, "ic_launcher_background.png"), { force: true });
    }
  }

  /*
   * Pozůstatky šablony Android Studio - vektorový Android robot a zelená
   * mřížka. Na API 24+ má `drawable-v24` vyšší prioritu než `mipmap`,
   * takže by stará šablona překryla nový PNG foreground.
   */
  await rm(path.join(RES, "drawable-v24", "ic_launcher_foreground.xml"), { force: true });
  await rm(path.join(RES, "drawable", "ic_launcher_background.xml"), { force: true });
}

/**
 * Adaptivní ikona je plátno 108 dp, z něhož launcher ukáže vnitřních 72 dp
 * a ořízne je vlastní maskou - kolečkem, squirclem, čtverečkem. Neoříznuté
 * zůstane jen to, co se vejde do kruhu o průměru 66 dp uprostřed.
 */
const PLATE_DP = 108;
const SAFE_ZONE_DP = 66;

/**
 * Jak daleko od středu značka sahá, v násobcích své delší strany.
 *
 * Počítá se, protože poměr pro zmenšení z toho vychází a hádat se nedá.
 * Trofej je širší, než vypadá - ouška trčí do stran a podstavec do rohů,
 * takže nejvzdálenější pixel leží mnohem dál než půlka výšky. Když se poměr
 * nastavil od oka na 0,66, sahala značka 43 dp od středu a kolečko Pixelu
 * (poloměr 36 dp) jí ouška uřízlo. Odsud to vyjde správně i po výměně
 * značky za jinak tvarovanou.
 */
async function markReach() {
  const { data, info } = await sharp(MARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const [cx, cy] = [width / 2, height / 2];
  let reach = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] <= 10) continue;
      reach = Math.max(reach, Math.hypot(x - cx, y - cy));
    }
  }
  return reach / Math.max(width, height);
}

const LAUNCHER = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SPLASH = {
  ldpi: [240, 320],
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};

/**
 * Značka zmenšená na `ratio` plátna a posazená doprostřed. Vrací hotový PNG
 * buffer schválně - `composite()` na jedné instanci sharpu nejde volat
 * dvakrát, druhé volání to první zahodí. Zaoblení se tak dělá až nad
 * výsledkem, ne řetězením na stejném objektu.
 */
async function centeredMark(size, ratio, background) {
  const inner = Math.round(size * ratio);
  const mark = await sharp(MARK)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

/**
 * Ikona pro starší Androidy (do API 25), kde si tvar nekreslí launcher.
 * Celý čtverec je vidět, takže značka dostane vlastní okraj - `0.72` je
 * poměr, při kterém trofej nedrhne o zaoblení rohu.
 */
async function processLauncher(size, radius) {
  const tile = await centeredMark(size, 0.72, hexToRgb(BRAND_NAVY));

  const rounded = Buffer.from(
    `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`,
  );
  return sharp(tile).composite([{ input: rounded, blend: "dest-in" }]).png().toBuffer();
}

/**
 * Popředí adaptivní ikony: značka uprostřed průhledného plátna. Průhledného
 * doslova - pozadí dodá `@color/ic_launcher_background`, tady se žádné
 * nekreslí. Kdyby se kreslilo, byla by v ikoně dvě přes sebe.
 */
async function processForeground(size, ratio) {
  return centeredMark(size, ratio, { r: 0, g: 0, b: 0, alpha: 0 });
}

/**
 * Monochromatická vrstva pro tématické ikony (Android 13+).
 *
 * Když si uživatel zapne ikony laděné do barev tapety, systém si z appky
 * vezme tuhle vrstvu a přebarví si ji sám - kouká jen na průhlednost, barvy
 * zahodí. Bez ní Android zšedne celou barevnou ikonu a trofej se v tom
 * ztratí. Silueta si detail udrží: mezery mezi stuhami a kolem fajfky jsou
 * ve značce průhledné, takže zůstanou průhledné i tady.
 */
async function processMonochrome(size, ratio) {
  const inner = Math.round(size * ratio);
  const shape = await sharp(MARK)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    // Barvy pryč, tvar nese průhlednost. Bílá proto, aby vrstva něco ukázala
    // i tam, kde by si ji prohlížeč resource nepřebarvil.
    .composite([{ input: { create: { width: inner, height: inner, channels: 3, background: "#FFFFFF" } }, blend: "in" }])
    .png()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shape, gravity: "center" }])
    .png()
    .toBuffer();
}

/** Splash: značka doprostřed barvy, do které se za chvíli prolne appka. */
async function processSplash(w, h) {
  const mark = Math.round(Math.min(w, h) * 0.26);
  const img = await sharp(MARK)
    .resize(mark, mark, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({ create: { width: w, height: h, channels: 4, background: hexToRgb(APP_BACKGROUND) } })
    .composite([{ input: img, gravity: "center" }])
    .png()
    .toBuffer();
}

/**
 * Logo pro appku samotnou (hlavička, Nastavení).
 *
 * Jde dovnitř jako data URI, protože appka běží offline ze souborů v telefonu
 * a tohle je jistota, že se obrázek načte i bez `public/`. Průhledné pozadí
 * je tu podstatné: značka sedí rovnou na ploše appky, žádná dlaždice pod ní
 * není - jinak by v hlavičce byla dvě pozadí přes sebe.
 *
 * 128 px stačí: v hlavičce se kreslí 32 px, v Nastavení 28 px, takže i na
 * trojnásobné hustotě zbývá rezerva. Větší by jen nafouklo bundle.
 */
async function writeLogoModule() {
  const png = await sharp(MARK)
    .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

  await write(
    path.join("src", "lib", "logo-image.ts"),
    Buffer.from(
      "// Generováno `npm run android:assets` z assets/logo_mark.png. Needitovat ručně.\n" +
        `export const logoImage = "data:image/png;base64,${png.toString("base64")}";\n`,
    ),
  );
  return png.length;
}

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;

async function generate() {
  await purgeStale();

  /*
   * Největší zmenšení, při kterém značka ještě celá padne do bezpečné zóny.
   * Ten 1 dp dole je rezerva na zaokrouhlení a na rozmazaný okraj po
   * zmenšení - bez něj vyjde nejvzdálenější pixel na 33,1 dp místo 33,0.
   */
  const foregroundRatio = (SAFE_ZONE_DP / 2 - 1) / PLATE_DP / (await markReach());

  // Ikona 1024 pro obchod a pro cokoli, co chce jeden hotový čtverec.
  await write("assets/icon.png", await processLauncher(1024, 225));

  for (const [density, size] of Object.entries(LAUNCHER)) {
    await write(path.join(RES, `mipmap-${density}`, "ic_launcher.png"), await processLauncher(size, size * 0.22));
    await write(path.join(RES, `mipmap-${density}`, "ic_launcher_round.png"), await processLauncher(size, size * 0.5));
    await write(
      path.join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"),
      await processForeground(FOREGROUND[density], foregroundRatio),
    );
    await write(
      path.join(RES, `mipmap-${density}`, "ic_launcher_monochrome.png"),
      await processMonochrome(FOREGROUND[density], foregroundRatio),
    );
  }

  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    await write(path.join(RES, "mipmap-anydpi-v26", name), Buffer.from(ADAPTIVE_XML));
  }

  /*
   * Tmavá varianta je stejný obrázek jako světlá.
   *
   * Splash je tmavý sám o sobě, takže se v nočním režimu nemá co měnit.
   * Vynechat `-night` ale nejde: Android by pak v tmavém režimu nesáhl
   * po ničem novém a zůstal by u toho, co v `res` leží - dřív po předchozí
   * appce. Radši ta samá data dvakrát než cizí logo.
   */
  for (const [density, [w, h]] of Object.entries(SPLASH)) {
    const port = await processSplash(w, h);
    const land = await processSplash(h, w);
    await write(path.join(RES, `drawable-port-${density}`, "splash.png"), port);
    await write(path.join(RES, `drawable-land-${density}`, "splash.png"), land);
    await write(path.join(RES, `drawable-port-night-${density}`, "splash.png"), port);
    await write(path.join(RES, `drawable-land-night-${density}`, "splash.png"), land);
  }
  const fallback = await processSplash(480, 800);
  await write(path.join(RES, "drawable", "splash.png"), fallback);
  await write(path.join(RES, "drawable-night", "splash.png"), fallback);
  await write("assets/splash.png", fallback);

  await write(
    path.join(RES, "values", "ic_launcher_background.xml"),
    Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BRAND_NAVY}</color>\n</resources>\n`,
    ),
  );

  await writeLogoModule();

  console.log(
    `Ikony a splash vygenerovány z ${MARK}. Ikona ${BRAND_NAVY}, splash ${APP_BACKGROUND}.\n` +
      `Popředí zmenšeno na ${(foregroundRatio * 100).toFixed(1)} % plátna, ` +
      `aby se značka vešla do bezpečné zóny ${SAFE_ZONE_DP} dp.`,
  );
}

generate().catch(console.error);
