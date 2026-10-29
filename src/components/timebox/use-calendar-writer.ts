"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
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
 * Drží vybraný kalendář telefonu v souladu s bloky time boxu: po každé změně
 * stavu (i té, co přijde synchronizací z jiného zařízení) a po návratu do
 * appky - to vrátí zpátky i události přepsané v Google kalendáři.
 */
export function useCalendarWriter() {
  const { state } = useStore();
  const { writeTo } = React.useSyncExternalStore(
    subscribeCalendarSettings,
    getCalendarSettings,
    getDefaultCalendarSettings,
  );
  const latest = React.useRef(state);
  latest.current = state;

  const write = React.useCallback(() => {
    queue = queue
      .then(() => writeBlocks(latest.current, todayISO()))
      // bez přístupu nebo se smazaným kalendářem - zkusí se při další změně
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!writeTo) return;
    // Psaní do políčka mění stav po písmenech - zapisuje se až po chvilce klidu.
    const timer = window.setTimeout(write, 1500);
    return () => window.clearTimeout(timer);
  }, [writeTo, state, write]);

  React.useEffect(() => {
    if (!writeTo) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") write();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [writeTo, write]);
}
