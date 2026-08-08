import { isNative } from "./native";

/**
 * Živé aktualizace.
 *
 * Celá appka je hromada statických souborů, které Capacitor servíruje
 * z telefonu. Když se ty soubory vymění, po restartu běží nová verze -
 * bez instalace APK. Nativní část (pluginy, ikona, oprávnění) se takhle
 * vyměnit nedá, na tu je potřeba nové APK.
 *
 * Průběh:
 *   start appky -> nasadí se balík stažený minule -> na pozadí se zkontroluje,
 *   jestli není novější -> stáhne se a nasadí až při dalším startu
 *
 * Nasazuje se schválně až při dalším startu, ne hned: přepnutí za běhu by
 * uživateli zmizela obrazovka pod rukama. Data zůstávají, localStorage patří
 * k adrese `localhost`, kterou výměna souborů nemění.
 */

const URL_KEY = "microwins:ota:url";
const CURRENT_KEY = "microwins:ota:current";
const PENDING_KEY = "microwins:ota:pending";
const BOOTING_KEY = "microwins:ota:booting";

/** Soubory balíku: cesta -> obsah. Bundle je čistě textový (js, css, html). */
export interface BundleFile {
  path: string;
  content: string;
}

export interface UpdateManifest {
  version: string;
  /** Adresa souboru s balíkem. Může být relativní k manifestu. */
  bundle: string;
  notes?: string;
  /** Minimální versionCode APK, kterou balík potřebuje (nepovinné). */
  minAppVersion?: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // soukromý režim - aktualizace se prostě nebude pamatovat
  }
}

export function getUpdateUrl(): string {
  return read(URL_KEY) ?? "";
}

export function setUpdateUrl(url: string): void {
  write(URL_KEY, url.trim() || null);
}

/** Verze, která právě běží. Prázdno = originál z APK. */
export function currentBundleVersion(): string | null {
  return read(CURRENT_KEY);
}

export function pendingBundleVersion(): string | null {
  const raw = read(PENDING_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return null;
  }
}

async function webView() {
  const { WebView } = await import("@capacitor/core");
  return WebView;
}

async function filesystem() {
  return import("@capacitor/filesystem");
}

/** Balík z APK, ke kterému se dá vždycky vrátit. */
export async function revertToBundled(): Promise<void> {
  if (!isNative()) return;
  const WebView = await webView();
  await WebView.setServerBasePath({ path: "" });
  await WebView.persistServerBasePath();
  write(CURRENT_KEY, null);
  write(PENDING_KEY, null);
  write(BOOTING_KEY, null);
}

/**
 * Appka naběhla, takže nasazený balík umí nastartovat.
 *
 * Značku hlídá krátký skript v `<head>` (viz `app/layout.tsx`): když ji do pár
 * vteřin nikdo nesmaže, znamená to bílou obrazovku a skript se vrátí k verzi
 * z APK. Hlídač musí být tam a ne tady - rozbitý balík tenhle soubor vůbec
 * nespustí.
 */
export function markBootSucceeded(): void {
  write(BOOTING_KEY, null);
  (window as unknown as { __mwBooted?: boolean }).__mwBooted = true;
}

/**
 * Nasadí balík stažený při minulém běhu. Volá se co nejdřív po startu,
 * ještě než uživatel začne něco dělat.
 *
 * Vrací nasazenou verzi, nebo `null`, když není co nasazovat.
 */
export async function applyPendingUpdate(): Promise<string | null> {
  if (!isNative()) return null;

  const raw = read(PENDING_KEY);
  if (!raw) return null;

  let pending: { version: string; path: string };
  try {
    pending = JSON.parse(raw) as { version: string; path: string };
  } catch {
    write(PENDING_KEY, null);
    return null;
  }

  try {
    const { Filesystem, Directory } = await filesystem();
    // Bez index.html by se appka po restartu neotevřela vůbec.
    await Filesystem.stat({ path: `${pending.path}/index.html`, directory: Directory.Data });

    const uri = await Filesystem.getUri({ path: pending.path, directory: Directory.Data });
    // Bridge chce holou cestu k adresáři, ne file:// URI.
    const dir = uri.uri.replace(/^file:\/\//, "");

    // Zapsat dřív, než se sáhne na WebView: setServerBasePath appku hned
    // překreslí a po překreslení se tenhle kód spustí znovu. Bez pořadí
    // by se aktualizace nasazovala pořád dokola.
    write(CURRENT_KEY, pending.version);
    write(PENDING_KEY, null);
    write(BOOTING_KEY, pending.version);

    const WebView = await webView();
    await WebView.setServerBasePath({ path: dir });
    await WebView.persistServerBasePath();
    return pending.version;
  } catch {
    // Balík je poškozený - zahodíme ho a běžíme dál na tom, co funguje.
    write(PENDING_KEY, null);
    return null;
  }
}

export type UpdateCheck =
  | { kind: "disabled" }
  | { kind: "up-to-date"; version: string | null }
  | { kind: "downloaded"; version: string; notes?: string }
  | { kind: "failed"; message: string };

/** Stáhne novější balík, pokud je. Nasadí se až při příštím startu. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isNative()) return { kind: "disabled" };
  const url = getUpdateUrl();
  if (!url) return { kind: "disabled" };

  try {
    const manifestRes = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!manifestRes.ok) return { kind: "failed", message: `Manifest: HTTP ${manifestRes.status}` };
    const manifest = (await manifestRes.json()) as UpdateManifest;
    if (!manifest?.version || !manifest?.bundle) {
      return { kind: "failed", message: "Manifest nemá version nebo bundle." };
    }

    const current = currentBundleVersion();
    if (manifest.version === current || manifest.version === pendingBundleVersion()) {
      return { kind: "up-to-date", version: current };
    }

    const bundleUrl = new URL(manifest.bundle, url).toString();
    const bundleRes = await fetch(bundleUrl, { cache: "no-store" });
    if (!bundleRes.ok) return { kind: "failed", message: `Balík: HTTP ${bundleRes.status}` };
    const files = (await bundleRes.json()) as BundleFile[];
    if (!Array.isArray(files) || !files.some((f) => f.path === "index.html")) {
      return { kind: "failed", message: "Balík neobsahuje index.html." };
    }

    const dir = `bundles/${manifest.version}`;
    const { Filesystem, Directory, Encoding } = await filesystem();

    // Zbytek po nepovedeném stahování by se míchal s novým balíkem.
    try {
      await Filesystem.rmdir({ path: dir, directory: Directory.Data, recursive: true });
    } catch {
      // ještě neexistuje
    }

    for (const file of files) {
      await Filesystem.writeFile({
        path: `${dir}/${file.path}`,
        data: file.content,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    }

    write(PENDING_KEY, JSON.stringify({ version: manifest.version, path: dir }));
    return { kind: "downloaded", version: manifest.version, notes: manifest.notes };
  } catch (e) {
    return { kind: "failed", message: String(e).slice(0, 160) };
  }
}
