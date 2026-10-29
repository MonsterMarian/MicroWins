"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import {
  getCalendarSettings,
  getDefaultCalendarSettings,
  subscribeCalendarSettings,
  writeBlocks,
} from "@/lib/calendar";
import { todayISO } from "@/lib/date";

/** Zápisy jdou za sebou - dva souběžné by tentýž blok založily dvakrát. */
let queue: Promise<void> = Promise.resolve();

/**
 * Drží vybraný kalendář telefonu v souladu s bloky time boxu: po změně bloků
 * (i té, co přijde synchronizací z jiného zařízení) a po návratu do appky -
 * to vrátí zpátky i události přepsané v Google kalendáři.
 *
 * Neběží, dokud se stav nenačetl (prázdný stav by zrcadlo smazal) a s
 * vypnutým Time boxem - jeho nastavení je pak schované a zápis by nešel vypnout.
 */
export function useCalendarWriter() {
  const { state, hydrated } = useStore();
  const { addons } = usePrefs();
  const { writeTo } = React.useSyncExternalStore(
    subscribeCalendarSettings,
    getCalendarSettings,
    getDefaultCalendarSettings,
  );
  const on = hydrated && addons.timebox && writeTo !== null;
  const latest = React.useRef(state);
  latest.current = state;
  // Po startu a návratu do appky se odešle i to, co minule nestihlo odejít.
  const resumed = React.useRef(true);

  const write = React.useCallback(() => {
    const syncAlways = resumed.current;
    resumed.current = false;
    queue = queue
      .then(() => writeBlocks(latest.current, todayISO(), syncAlways))
      // bez přístupu nebo se smazaným kalendářem - zkusí se při další změně
      .catch(() => {});
  }, []);

  // Jen to, z čeho se skládá blok a jeho název (`blockTitle`).
  const { timeBlocks, todos, tasks, daySheets } = state;
  React.useEffect(() => {
    if (!on) return;
    // Psaní do políčka mění stav po písmenech - zapisuje se až po chvilce klidu.
    const timer = window.setTimeout(write, 1500);
    return () => window.clearTimeout(timer);
  }, [on, writeTo, timeBlocks, todos, tasks, daySheets, write]);

  React.useEffect(() => {
    if (!on) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      resumed.current = true;
      write();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [on, write]);
}
