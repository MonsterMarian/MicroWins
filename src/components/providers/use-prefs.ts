"use client";

import * as React from "react";
import { getDefaultPrefs, getPrefs, setPrefs, subscribePrefs, type Prefs } from "@/lib/prefs";

/**
 * Nastavení zobrazení. Store je čistý modul v `lib/prefs.ts`, tady je jen most
 * do Reactu - proto žádný provider a žádný context.
 */
export function usePrefs(): Prefs {
  return React.useSyncExternalStore(subscribePrefs, getPrefs, getDefaultPrefs);
}

export { setPrefs };
