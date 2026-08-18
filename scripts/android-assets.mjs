import { readdir, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RES = path.join("android", "app", "src", "main", "res");

const SOURCE_IMAGE = "assets/icon_source.jpg";

/**
 * Pozadí adaptivní ikony se čte z rohu fotky, ne z konstanty.
 *
 * Fotka má vlastní tmavé pozadí a popředí ikony je její výřez - když se ty dvě
 * barvy rozejdou, je v ikoně vidět světlejší čtverec fotky na tmavším podkladu.
 * Přesně to se stalo, když pozadí zůstalo napevno na #09090B a fotka měla
 * #161616. Odečtením z fotky to sedí i po její výměně.
 */
async function backgroundColor() {
  const { data, info } = await sharp(SOURCE_IMAGE).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [0, 1, 2].map((i) => data[(2 * info.width + 2) * info.channels + i]);
  return { hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`, r, g, b };
}

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

async function processImage(size, radius = 0) {
    let img = sharp(SOURCE_IMAGE).resize(size, size, { fit: 'cover' });
    
    if (radius > 0) {
        const roundedRect = Buffer.from(
            `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`
        );
        img = img.composite([{ input: roundedRect, blend: 'dest-in' }]);
    }
    
    return await img.png().toBuffer();
}

/**
 * Popředí adaptivní ikony.
 *
 * Tvar ikony si kreslí launcher - ořízne plátno svojí maskou (kolečko,
 * čtvereček, squircle) a garantuje jen vnitřních zhruba 66 %. Fotka proto sedí
 * zmenšená uprostřed, ale zůstává **čtvercová**: kdo si v launcheru nastaví
 * čtvereček, dostane čtvereček. Dřív se tu fotka ořezávala natvrdo do kruhu,
 * takže kolečko bylo vidět i na hranatém launcheru - a maska k tomu uřízla
 * poháru podstavec.
 */
async function processForeground(size) {
    const innerSize = Math.round(size * 0.66);
    const img = await sharp(SOURCE_IMAGE)
        .resize(innerSize, innerSize, { fit: 'cover' })
        .png()
        .toBuffer();

    return await sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).composite([{ input: img, gravity: 'center' }]).png().toBuffer();
}

async function processSplash(w, h, bg) {
    // Splash: velké logo doprostřed tmavého plátna.
    const mark = Math.round(Math.min(w, h) * 0.26);
    let img = await sharp(SOURCE_IMAGE)
        .resize(mark, mark, { fit: 'cover' })
        .toBuffer();
        
    const roundedRect = Buffer.from(
        `<svg><rect x="0" y="0" width="${mark}" height="${mark}" rx="${mark * 0.2}" ry="${mark * 0.2}"/></svg>`
    );
    img = await sharp(img).composite([{ input: roundedRect, blend: 'dest-in' }]).png().toBuffer();
    
    return await sharp({
        create: {
            width: w,
            height: h,
            channels: 4,
            background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 }
        }
    }).composite([{ input: img, gravity: 'center' }]).png().toBuffer();
}

async function generate() {
    const bg = await backgroundColor();
    await purgeStale();

    // Generate rounded icon for general assets
    const roundedIcon = await processImage(1024, 225);
    await write("assets/icon.png", roundedIcon);
    await write("assets/splash.png", roundedIcon);

    for (const [density, size] of Object.entries(LAUNCHER)) {
      const icon = await processImage(size, size * 0.22);
      const iconRound = await processImage(size, size * 0.5); // kruhová
      await write(path.join(RES, `mipmap-${density}`, "ic_launcher.png"), icon);
      await write(path.join(RES, `mipmap-${density}`, "ic_launcher_round.png"), iconRound);
      
      const fg = await processForeground(FOREGROUND[density]);
      await write(path.join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"), fg);
    }

    /*
     * Tmavá varianta je stejný obrázek jako světlá.
     *
     * Splash je tmavý sám o sobě (pozadí se bere z fotky), takže se v nočním
     * režimu nemá co měnit. Vynechat `-night` ale nejde: Android by pak
     * v tmavém režimu nesáhl po ničem novém a zůstal by u toho, co v `res`
     * leží - dřív po předchozí appce. Radši ta samá data dvakrát než cizí logo.
     */
    for (const [density, [w, h]] of Object.entries(SPLASH)) {
      const port = await processSplash(w, h, bg);
      const land = await processSplash(h, w, bg);
      await write(path.join(RES, `drawable-port-${density}`, "splash.png"), port);
      await write(path.join(RES, `drawable-land-${density}`, "splash.png"), land);
      await write(path.join(RES, `drawable-port-night-${density}`, "splash.png"), port);
      await write(path.join(RES, `drawable-land-night-${density}`, "splash.png"), land);
    }
    const fallback = await processSplash(480, 800, bg);
    await write(path.join(RES, "drawable", "splash.png"), fallback);
    await write(path.join(RES, "drawable-night", "splash.png"), fallback);

    await write(
      path.join(RES, "values", "ic_launcher_background.xml"),
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg.hex}</color>\n</resources>\n`,
      ),
    );

    console.log(`Ikony a splash vygenerovány z fotky. Pozadí ${bg.hex} (odečteno z fotky).`);
}

generate().catch(console.error);
