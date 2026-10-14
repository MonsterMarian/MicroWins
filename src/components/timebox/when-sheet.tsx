"use client";

import * as React from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { addDays, DAY_SHORT, fromISODate } from "@/lib/date";
import {
  blocksOfDay,
  DURATION_CHOICES,
  formatLength,
  formatMinutes,
  nextFreeSlot,
} from "@/lib/timeblocks";
import { slotChoices, timeboxRows, timeboxSlots } from "@/lib/timebox";
import type { ISODate } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Výběr času ťuknutím - „Kdy?“.
 *
 * Na telefonu je tah přes celou mřížku (přes 1 600 px s rolováním u okraje)
 * nejhorší cesta, jak trefit konkrétní půlhodinu. Tady se čas jen vybere:
 * nahoře délka, pod ní nejbližší volno a pak všechny půlhodiny dne. Ťuknutí
 * na čas rovnou plánuje - druhé potvrzovací tlačítko by byla práce navíc.
 *
 * Otevírá se z toastu „Změnit“ po ťuknutí na úchyt a podržením úchytu bez
 * pohybu.
 */

export interface WhenRequest {
  /** Co se plánuje - jen na nadpis. */
  title: string;
  date: ISODate;
  duration: number;
  /** Přeplánovávaný blok - jeho vlastní místo se nepočítá jako obsazené. */
  exclude?: string | null;
}

export interface WhenPick {
  date: ISODate;
  start: number;
  duration: number;
}

/**
 * Odkud hledat volné místo v mřížce. Dnes od nynějška - do minulosti se
 * neplánuje - jiný den od začátku mřížky.
 */
export function searchFrom(date: ISODate, today: ISODate, timeboxStart: number): number {
  if (date !== today) return timeboxStart * 60;
  const now = new Date();
  return Math.max(timeboxStart * 60, now.getHours() * 60 + now.getMinutes());
}

function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return "dnes";
  if (date === addDays(today, 1)) return "zítra";
  const d = fromISODate(date);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
}

export function WhenSheet({
  request,
  onClose,
  onPick,
}: {
  request: WhenRequest | null;
  onClose: () => void;
  onPick: (pick: WhenPick) => void;
}) {
  return (
    <BottomSheet
      open={request !== null}
      onClose={onClose}
      title={request ? `Kdy: ${request.title}` : ""}
      description="Ťukni na čas a je naplánováno. Obsazené půlhodiny jsou ztlumené, ale jdou taky."
    >
      {/* Klíč podle požadavku: každé otevření začíná s jeho dnem a délkou. */}
      {request ? (
        <WhenBody
          key={`${request.title}|${request.date}|${request.exclude ?? ""}`}
          request={request}
          onPick={onPick}
        />
      ) : null}
    </BottomSheet>
  );
}

function WhenBody({ request, onPick }: { request: WhenRequest; onPick: (pick: WhenPick) => void }) {
  const { state, today } = useStore();
  const { timeboxStart, timeboxEnd } = usePrefs();
  const [day, setDay] = React.useState<ISODate>(request.date);
  const [duration, setDuration] = React.useState(request.duration);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slots = timeboxSlots(timeboxRows(day, timeboxStart, timeboxEnd));
  const choices = slotChoices(slots, state.timeBlocks, { today, nowMinutes, exclude: request.exclude });

  /* Nejbližší volno pro zvolenou délku - nikdy ne do minulosti. */
  const nearest = (() => {
    const blocks = blocksOfDay(state, day).filter((b) => b.id !== request.exclude);
    const start = nextFreeSlot(blocks, searchFrom(day, today, timeboxStart), duration);
    return { date: day, start };
  })();

  const days = [request.date, addDays(request.date, 1), addDays(request.date, 2)];

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Délka</span>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_CHOICES.map((minutes) => (
            <Chip key={minutes} on={minutes === duration} onClick={() => setDuration(minutes)}>
              {formatLength(minutes)}
            </Chip>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onPick({ ...nearest, duration })}
        className="h-12 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
      >
        Nejbližší volno · {formatMinutes(nearest.start)}
        {nearest.date !== request.date ? ` (${dayLabel(nearest.date, today)})` : ""}
      </button>

      <div className="flex gap-1.5" role="group" aria-label="Den">
        {days.map((d) => (
          <Chip key={d} on={d === day} onClick={() => setDay(d)} className="flex-1">
            {dayLabel(d, today)}
          </Chip>
        ))}
      </div>

      {choices.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Tenhle den už v mřížce žádná půlhodina nezbývá.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {choices.map((choice) => (
            <button
              key={`${choice.date}-${choice.start}`}
              type="button"
              onClick={() => onPick({ date: choice.date, start: choice.start, duration })}
              aria-label={`${formatMinutes(choice.start)}${choice.busy ? ", už tam něco je" : ""}`}
              className={cn(
                "tabular relative h-11 rounded-lg border text-sm transition-colors active:bg-progress active:text-progress-foreground",
                choice.start % 60 === 0 ? "font-medium" : "text-muted-foreground",
                choice.busy && "border-dashed bg-muted/40 text-muted-foreground/60",
              )}
            >
              {formatMinutes(choice.start)}
              {choice.date !== day ? (
                <span className="absolute right-1 top-0.5 text-[9px] text-muted-foreground">+1</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
  className,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "tabular h-10 rounded-full border px-3.5 text-sm transition-colors",
        on ? "border-progress bg-progress font-semibold text-progress-foreground" : "hover:bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}
