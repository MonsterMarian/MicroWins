"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { SwitchPill } from "@/components/ui/switch-pill";
import { useStore } from "@/components/providers/store-provider";
import { setPrefs, usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import {
  applyPulls,
  calendarAvailable,
  clearMirror,
  describeConflict,
  getCalendarSettings,
  getConflicts,
  getDefaultCalendarSettings,
  getServerConflicts,
  listPhoneCalendars,
  requestCalendarAccess,
  resolveConflict,
  setCalendarSettings,
  subscribeCalendarSettings,
  subscribeConflicts,
  type PendingConflict,
  type PhoneCalendar,
} from "@/lib/calendar";
import { todayISO } from "@/lib/date";
import { isNative } from "@/lib/native";
import { deviceId } from "@/lib/sync-runtime";
import { cn } from "@/lib/utils";

/** Kde je nejnovější APK - kalendář potřebuje nativní pluginy, OTA je nepřinese. */
const RELEASES_URL = "https://github.com/MonsterMarian/MicroWins/releases/latest";

/**
 * Napojení time boxu na kalendář telefonu (a přes něj na Google Kalendář).
 * Jen v Android appce s kalendářovými pluginy (nové APK) a jen pro tohle
 * zařízení - viz `lib/calendar.ts`. O přístup se appka ptá až tady.
 */
export function CalendarSection() {
  const { addons, calendarWriter } = usePrefs();
  const { toast } = useToast();
  const { read, writeTo } = React.useSyncExternalStore(
    subscribeCalendarSettings,
    getCalendarSettings,
    getDefaultCalendarSettings,
  );
  const conflicts = React.useSyncExternalStore(subscribeConflicts, getConflicts, getServerConflicts);
  /** null = appka ke kalendáři zatím nesmí (seznam bez přístupu spadne). */
  const [calendars, setCalendars] = React.useState<PhoneCalendar[] | null>(null);

  const load = React.useCallback(async () => {
    try {
      setCalendars(await listPhoneCalendars());
    } catch {
      setCalendars(null);
    }
  }, []);

  React.useEffect(() => {
    if (calendarAvailable()) void load();
  }, [load]);

  if (!addons.timebox) return null;
  // Starší APK s novým webem z OTA: kalendář nejde, ale ať je vidět proč a kde je nové.
  if (!calendarAvailable()) {
    if (!isNative()) return null;
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Kalendář
        </h3>
        <p className="px-1 text-xs text-muted-foreground">
          Propojení s Google kalendářem potřebuje novější verzi aplikace - aktualizace přes
          internet ji nepřinese. Stáhni a nainstaluj nové APK, data zůstanou.
        </p>
        <a
          href={RELEASES_URL}
          className="self-start rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Stáhnout nové APK
        </a>
      </section>
    );
  }

  const me = deviceId();
  /** Zrcadlo smí běžet jen na jednom telefonu - na jiném běží, když ho vlastní on. */
  const elsewhere = calendarWriter !== null && calendarWriter !== me;

  /** Bloky ve starém kalendáři by tam zůstaly navždy - smažou se. */
  const changeTarget = (next: string | null) => {
    const previous = writeTo;
    setCalendarSettings({ writeTo: next });
    if (next) setPrefs({ calendarWriter: me });
    else if (calendarWriter === me) setPrefs({ calendarWriter: null });
    if (previous && previous !== next) void clearMirror(previous, todayISO()).catch(() => {});
  };

  const allow = async () => {
    if (await requestCalendarAccess()) {
      void load();
      return;
    }
    toast({
      tone: "warn",
      title: "Bez přístupu ke kalendáři",
      description: "Povol ho appce v nastavení Androidu.",
    });
  };

  const writable = (calendars ?? []).filter((c) => c.writable);

  if (calendars === null) {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Kalendář
        </h3>
        <Button size="sm" variant="outline" className="self-start" onClick={() => void allow()}>
          Propojit s kalendářem v telefonu
        </Button>
        <p className="px-1 text-xs text-muted-foreground">
          Schůzky z Google kalendáře se ukážou v time boxu a bloky se dají zapisovat zpátky.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Kalendář
      </h3>

      <button
        type="button"
        onClick={() => setCalendarSettings({ read: !read })}
        aria-pressed={read}
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
          read ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">Ukazovat schůzky v time boxu</span>
          <span className="block text-xs text-muted-foreground">
            {read
              ? "Události z kalendářů v telefonu jsou v mřížce ztlumeně."
              : "Mřížka ukazuje jen tvoje bloky."}
          </span>
        </span>
        <SwitchPill on={read} />
      </button>

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Bloky a ToDo propojit s</span>
        <Select
          value={writeTo ?? ""}
          onChange={(e) => changeTarget(e.target.value || null)}
          aria-label="Kalendář pro zápis bloků"
          className="h-8 w-auto max-w-full text-xs"
        >
          <option value="">nepropojovat</option>
          {writable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.account && c.account !== c.title ? ` · ${c.account}` : ""}
            </option>
          ))}
          {writeTo && !writable.some((c) => c.id === writeTo) ? (
            <option value={writeTo}>vybraný kalendář</option>
          ) : null}
        </Select>
      </label>

      {elsewhere ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">
            Propojení teď běží na jiném telefonu. Dva najednou by si kalendář přetahovaly,
            proto tady stojí.
          </span>
          {writeTo ? (
            <Button size="sm" variant="outline" onClick={() => setPrefs({ calendarWriter: me })}>
              Převzít sem
            </Button>
          ) : null}
        </div>
      ) : null}

      {conflicts.length > 0 ? <ConflictList conflicts={conflicts} /> : null}

      <p className="px-1 text-xs text-muted-foreground">
        Bloky od včerejška dál a ToDo s termínem (bez hodiny jako celodenní) se zrcadlí do
        vybraného kalendáře oběma směry: přejmenování, posun i smazání v Googlu se propíše sem,
        ✓ na začátku názvu odškrtne. Změníš-li totéž tady i v Googlu, zůstane verze z appky a
        konflikt počká níž v seznamu. Propojení běží jen na jednom telefonu. Nejlíp si na to v
        Google kalendáři založ vlastní, třeba MicroWins. Po přepnutí jinam se zrcadlo ze starého
        kalendáře smaže.
      </p>
    </section>
  );
}

/** Konflikty, které hláška ohlásila a nikdo je zatím nerozhodl. */
function ConflictList({ conflicts }: { conflicts: PendingConflict[] }) {
  const store = useStore();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">Změněno v appce i v Googlu ({conflicts.length})</span>
      {conflicts.map((conflict) => {
        const text = describeConflict(conflict);
        return (
          <div
            key={`${conflict.key}-${conflict.field}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{text.title}</span>
              <span className="block text-muted-foreground">{text.description}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                applyPulls(store.state, [conflict.useGoogle], store);
                resolveConflict(conflict);
              }}
            >
              {text.action}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resolveConflict(conflict)}>
              Nechat
            </Button>
          </div>
        );
      })}
    </div>
  );
}
