"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import {
  getCalendarSettings,
  getDefaultCalendarSettings,
  listPhoneCalendars,
  requestCalendarAccess,
  setCalendarSettings,
  subscribeCalendarSettings,
  type PhoneCalendar,
} from "@/lib/calendar";
import { isNative } from "@/lib/native";
import { cn } from "@/lib/utils";

/**
 * Napojení time boxu na kalendář telefonu (a přes něj na Google Kalendář).
 * Jen v Android appce a jen pro tohle zařízení - viz `lib/calendar.ts`.
 * O přístup ke kalendáři se appka ptá až tady, při zapnutí.
 */
export function CalendarSection() {
  const { addons } = usePrefs();
  const { toast } = useToast();
  const { read, writeTo } = React.useSyncExternalStore(
    subscribeCalendarSettings,
    getCalendarSettings,
    getDefaultCalendarSettings,
  );
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
    if (isNative()) void load();
  }, [load]);

  if (!addons.timebox || !isNative()) return null;

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
        <span
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            read ? "bg-progress" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "absolute top-1 size-4 rounded-full bg-card shadow transition-[left] duration-200",
              read ? "left-6" : "left-1",
            )}
          />
        </span>
      </button>

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Bloky zapisovat do</span>
        <Select
          value={writeTo ?? ""}
          onChange={(e) => setCalendarSettings({ writeTo: e.target.value || null })}
          aria-label="Kalendář pro zápis bloků"
          className="h-8 w-auto max-w-full text-xs"
        >
          <option value="">nezapisovat</option>
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

      <p className="px-1 text-xs text-muted-foreground">
        Platí jen pro tenhle telefon. Bloky od včerejška na dva týdny dopředu se zrcadlí do
        vybraného kalendáře - nejlíp si na to v Google kalendáři založ vlastní, třeba MicroWins.
        Upravuj je tady, změny udělané v Googlu appka přepíše.
      </p>
    </section>
  );
}
