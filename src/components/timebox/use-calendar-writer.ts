"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import {
  addConflicts,
  applyPulls,
  describeConflict,
  getCalendarSettings,
  getDefaultCalendarSettings,
  onCalendarChange,
  resolveConflict,
  setBackgroundSync,
  subscribeCalendarSettings,
  syncMirror,
  syncPhoneCalendars,
  type MirrorConflict,
} from "@/lib/calendar";
import { todayISO } from "@/lib/date";
import { deviceId } from "@/lib/sync-runtime";
import { blockTitle } from "@/lib/timeblocks";

/** Běhy jdou za sebou - dva souběžné by tentýž blok založily dvakrát. */
let queue: Promise<void> = Promise.resolve();

/** S otevřenou appkou se z Googlu stahuje co 3 minuty - jinak by nová schůzka čekala na návrat. */
const FOREGROUND_SYNC_MS = 3 * 60_000;

/**
 * Drží vybraný kalendář telefonu a time box v souladu, oběma směry
 * (`syncMirror` + `applyPulls`): po změně bloků či ToDo, po změně kalendáře
 * v telefonu (synchronizace přinesla úpravu z Googlu) a po návratu do appky.
 * Konflikty (tatáž věc změněná na obou stranách) ohlásí a uloží do seznamu
 * v Nastavení, odkud jde vzít verzi z Googlu i později.
 *
 * Neběží, dokud se stav nenačetl (prázdný stav by zrcadlo smazal), s
 * vypnutým Time boxem (jeho nastavení je pak schované) a na telefonu, který
 * zrcadlo nevlastní (`prefs.calendarWriter`) - dva by si ho přetahovaly.
 */
export function useCalendarWriter() {
  const store = useStore();
  const { state, hydrated } = store;
  const { addons, calendarWriter } = usePrefs();
  const { toast } = useToast();
  const { read, writeTo } = React.useSyncExternalStore(
    subscribeCalendarSettings,
    getCalendarSettings,
    getDefaultCalendarSettings,
  );
  const on = hydrated && addons.timebox && writeTo !== null && calendarWriter === deviceId();
  const latest = React.useRef({ store, toast });
  latest.current = { store, toast };
  // Po startu a návratu do appky se i stáhnou novinky a odešle, co nestihlo.
  const resumed = React.useRef(true);
  const timer = React.useRef<number | undefined>(undefined);

  const announce = React.useCallback((conflict: MirrorConflict) => {
    const text = describeConflict(conflict);
    latest.current.toast({
      tone: "warn",
      title: text.title,
      description: text.description,
      action: {
        label: text.action,
        onClick: () => {
          const { store: api } = latest.current;
          applyPulls(api.state, [conflict.useGoogle], api);
          resolveConflict(conflict);
        },
      },
    });
  }, []);

  const write = React.useCallback(() => {
    const syncAlways = resumed.current;
    resumed.current = false;
    queue = queue
      .then(async () => {
        const run = await syncMirror(latest.current.store.state, todayISO(), syncAlways);
        if (run.pull.length > 0) {
          const { store: api, toast: say } = latest.current;
          const removed = applyPulls(api.state, run.pull, api);
          for (const block of removed.blocks) {
            say({
              tone: "info",
              title: "Smazáno v Google kalendáři",
              description: blockTitle(api.state, block),
              action: { label: "Vrátit", onClick: () => latest.current.store.restoreBlock(block) },
            });
          }
          for (const todo of removed.todos) {
            say({
              tone: "info",
              title: "Hotovo podle Google kalendáře",
              description: todo.text,
              action: { label: "Vrátit", onClick: () => latest.current.store.toggleTodo(todo.id) },
            });
          }
        }
        // Konflikt: zůstala appka - verzi z Googlu jde vzít z hlášky i ze seznamu.
        addConflicts(run.conflicts);
        run.conflicts.forEach(announce);
        run.commit();
      })
      // bez přístupu nebo se smazaným kalendářem - zkusí se při další změně
      .catch(() => {});
  }, [announce]);

  /** Psaní i synchronizace mění stav po kouscích - běží se až po chvilce klidu. */
  const soon = React.useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(write, 1500);
  }, [write]);

  // Jen to, z čeho se skládá zrcadlo: bloky, ToDo a jejich názvy (`blockTitle`).
  const { timeBlocks, todos, tasks, daySheets } = state;
  React.useEffect(() => {
    if (!on) return;
    soon();
    return () => window.clearTimeout(timer.current);
  }, [on, writeTo, timeBlocks, todos, tasks, daySheets, soon]);

  React.useEffect(() => {
    if (!on) return;
    const stopWatching = onCalendarChange(soon);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      resumed.current = true;
      write();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopWatching();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on, write, soon]);

  // Stahování z Googlu: s otevřenou appkou co pár minut, zavřenou na pozadí.
  const syncing = read || on;
  React.useEffect(() => {
    void setBackgroundSync(syncing);
    if (!syncing) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncPhoneCalendars();
    }, FOREGROUND_SYNC_MS);
    return () => window.clearInterval(id);
  }, [syncing]);
}
