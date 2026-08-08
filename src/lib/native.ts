/**
 * Most do nativní vrstvy.
 *
 * Appka běží ve dvou prostředích: v prohlížeči při vývoji a jako Android appka
 * přes Capacitor. Všechno tady je proto podmíněné - v prohlížeči se nic
 * nestane a nic nespadne. Pluginy se načítají dynamicky, aby se do webového
 * buildu netahal nativní kód.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** Krátké cvaknutí při zaškrtnutí winu - na mobilu, jinak nic. */
export async function tapFeedback(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // zařízení bez vibrace - není co řešit
  }
}

/** Delší cvaknutí, když padne microwin. */
export async function winFeedback(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // zařízení bez vibrace
  }
}

/** Stavová lišta v barvě appky, ikony podle světlosti tématu. */
export async function syncStatusBar(dark: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? "#09090B" : "#FDFDFD" });
  } catch {
    // starší Android bez podpory barvy lišty
  }
}

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    // splash se skryje sám podle launchShowDuration
  }
}

/**
 * Hardwarové tlačítko Zpět. Uvnitř appky jde o krok zpět v historii,
 * na hlavní obrazovce appku ukončí - tak se chová každá Android appka.
 */
export async function registerBackButton(onBack: () => boolean): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const { App } = await import("@capacitor/app");
    const handle = await App.addListener("backButton", () => {
      const handled = onBack();
      if (!handled) void App.exitApp();
    });
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}
