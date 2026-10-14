/**
 * Profilová fotka.
 *
 * Fotka z telefonu má klidně 4 MB. Do účtu jde jako malý čtverec (256 px,
 * JPEG) přímo v nastavení appky - synchronizuje se tak na všechna zařízení
 * stejnou cestou jako barva nebo pořadí záložek a na serveru se kvůli ní nic
 * nezakládá. Řádek v databázi má pak pár desítek kB.
 */

/** Strana čtverce v pixelech - na kolečko ve 2× i 3× hustotě displeje stačí. */
export const AVATAR_SIZE = 256;

/** Horní mez pro fotku v nastavení - pojistka proti nesmyslu ze sítě. */
export const AVATAR_MAX_LENGTH = 200_000;

/** Je to fotka, kterou appka umí ukázat (data URI obrázku, ne moc velká)? */
export function isAvatar(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= AVATAR_MAX_LENGTH &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

/**
 * Výřez čtverce ze středu obrázku: kratší strana se vejde celá, delší se
 * ořízne rovnoměrně z obou stran - obličej bývá uprostřed.
 */
export function centerSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/** Zmenší vybranou fotku na čtverec `AVATAR_SIZE` a vrátí ji jako data URI. */
export async function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Tohle není obrázek.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const crop = centerSquare(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Fotku se nepodařilo zpracovat.");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const data = canvas.toDataURL("image/jpeg", 0.85);
    if (!isAvatar(data)) throw new Error("Fotku se nepodařilo zmenšit.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Fotku se nepodařilo načíst."));
    image.src = src;
  });
}
