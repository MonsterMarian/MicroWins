import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RES = path.join("android", "app", "src", "main", "res");

// Tmavé pozadí odpovídající obrázku nebo defaultní
const BG = "#09090B";

const SOURCE_IMAGE = "assets/icon_source.jpg";

async function write(file, buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
}

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SPLASH = {
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

async function processForeground(size) {
    // Pro adaptive ikonu zmenšíme obrázek, aby seděl doprostřed a nebyl oříznut.
    // Ořízneme ho na kruh a vložíme do průhledného plátna.
    const innerSize = Math.round(size * 0.66);
    let img = await sharp(SOURCE_IMAGE)
        .resize(innerSize, innerSize, { fit: 'cover' })
        .toBuffer();
    
    // uděláme z něj kruh
    const circle = Buffer.from(`<svg><circle cx="${innerSize/2}" cy="${innerSize/2}" r="${innerSize/2}"/></svg>`);
    img = await sharp(img).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
    
    return await sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).composite([{ input: img, gravity: 'center' }]).png().toBuffer();
}

async function processSplash(w, h) {
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
            background: { r: 9, g: 9, b: 11, alpha: 1 } // #09090B
        }
    }).composite([{ input: img, gravity: 'center' }]).png().toBuffer();
}

async function generate() {
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

    for (const [density, [w, h]] of Object.entries(SPLASH)) {
      await write(path.join(RES, `drawable-port-${density}`, "splash.png"), await processSplash(w, h));
      await write(path.join(RES, `drawable-land-${density}`, "splash.png"), await processSplash(h, w));
    }
    await write(path.join(RES, "drawable", "splash.png"), await processSplash(480, 800));

    await write(
      path.join(RES, "values", "ic_launcher_background.xml"),
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
      ),
    );

    console.log("Ikony a splash vygenerovány z fotky.");
}

generate().catch(console.error);
