"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { DAY_SHORT, dayOfMonth, fromISODate } from "@/lib/date";
import {
  blocksOfDay,
  clampStart,
  DEFAULT_DURATION,
  layoutDay,
  pinsOfDay,
  snapMinutes,
  type DuePin,
} from "@/lib/timeblocks";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BlockCard, PinCard } from "./block-card";
import { pinBlock, PIN_PREFIX, useGridRange } from "./grid";
import { useBlockDrag, type BlockDragApi } from "./use-block-drag";

/** Sedm dnů vedle sebe je hustší než jeden - hodina má 54 px. */
const WEEK_PX_PER_MIN = 0.9;

/** Sloupec s hodinami. Užší než v ose dne, popisky jsou po dvou hodinách. */
const GUTTER = 30;

/**
 * Týden - sedm sloupců vedle sebe.
 *
 * Odpovídá na jinou otázku než osa dne: ne „jak vypadá dnešek", ale „kdy
 * v tomhle týdnu na to vůbec bude čas". Proto se tu blok dá chytit a přehodit
 * i **do jiného dne** - vodorovný tah mění den, svislý čas.
 *
 * Bloky jsou bez času a bez zaškrtávátka: v tomhle měřítku by se z toho stala
 * změť a na detail je jedno ťuknutí do editoru.
 */
export function WeekView({
  days,
  today,
  nowMinutes,
  gridRef,
  onPick,
  onOpen,
  onPlanPin,
}: {
  days: ISODate[];
  today: ISODate;
  nowMinutes: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onPick: (date: ISODate, start: number) => void;
  onOpen: (block: TimeBlock) => void;
  onPlanPin: (pin: DuePin) => void;
}) {
  const { state } = useStore();

  const perDay = React.useMemo(
    () =>
      days.map((date) => ({
        date,
        blocks: blocksOfDay(state, date),
        pins: pinsOfDay(state, date),
      })),
    [state, days],
  );
  const allBlocks = React.useMemo(() => perDay.flatMap((d) => d.blocks), [perDay]);
  const allPins = React.useMemo(() => perDay.flatMap((d) => d.pins), [perDay]);

  const range = useGridRange(allBlocks, allPins, days[0]);
  const { fromHour, toHour, fromMin, extendEarly, extendLate } = range;
  const height = (toHour - fromHour) * 60 * WEEK_PX_PER_MIN;
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);

  /** Který den leží pod prstem - z toho se při tahu mění datum bloku. */
  const dayAt = React.useCallback(
    (clientX: number): ISODate | null => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const column = (rect.width - GUTTER) / days.length;
      const index = Math.floor((clientX - rect.left - GUTTER) / column);
      return days[Math.min(days.length - 1, Math.max(0, index))] ?? null;
    },
    [days, gridRef],
  );

  const drag = useBlockDrag({ pxPerMin: WEEK_PX_PER_MIN, dayAt });

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = gridRef.current?.getBoundingClientRect();
    const date = dayAt(e.clientX);
    if (!rect || !date) return;
    const minutes = fromMin + (e.clientY - rect.top) / WEEK_PX_PER_MIN;
    onPick(date, clampStart(snapMinutes(minutes), DEFAULT_DURATION));
  };

  /* Tažený blok patří tomu dni, nad kterým právě visí - jinak by při
     přehazování zmizel ze starého sloupce až po puštění. */
  const preview = drag.drag;
  const dayOf = (block: TimeBlock) => (preview?.id === block.id ? preview.date : block.date);

  return (
    <Card className="overflow-hidden p-0 shrink-0">
      <div className="flex border-b">
        <div className="shrink-0" style={{ width: GUTTER }} />
        {perDay.map(({ date, blocks, pins }) => (
          <DayHead key={date} date={date} today={today} count={blocks.length + pins.length} />
        ))}
      </div>

      {fromHour > 0 ? <EdgeButton dir="up" onClick={extendEarly} /> : null}

      <div
        ref={gridRef}
        data-from-min={fromMin}
        className="relative flex"
        style={{ height }}
        onClick={pick}
      >
        {/* Linky hodin jdou přes celou mřížku, popisky sedí ve sloupci vlevo. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {hours.map((hour, i) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/50"
              style={{ top: i * 60 * WEEK_PX_PER_MIN }}
            >
              {hour % 2 === 0 ? (
                <span className="tabular absolute -top-[6px] left-0 w-6 text-right text-[10px] leading-none text-muted-foreground/70">
                  {hour}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="shrink-0" style={{ width: GUTTER }} />

        {perDay.map(({ date, pins }) => (
          <div
            key={date}
            className={cn(
              "relative min-w-0 flex-1 border-l border-border/50",
              date === today && "bg-accent/25",
            )}
          >
            <DayColumn
              date={date}
              blocks={allBlocks.filter((b) => dayOf(b) === date)}
              pins={pins}
              fromMin={fromMin}
              drag={drag}
              onOpen={onOpen}
              onPlanPin={onPlanPin}
            />

            {date === today && nowMinutes >= fromMin && nowMinutes <= toHour * 60 ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
                style={{ top: (nowMinutes - fromMin) * WEEK_PX_PER_MIN }}
              >
                <span className="absolute -left-1.5 -top-[5px] size-2.5 rounded-full bg-red-500" />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {toHour < 24 ? <EdgeButton dir="down" onClick={extendLate} /> : null}
    </Card>
  );
}

/** Bloky jednoho dne. Překryvy se řeší uvnitř sloupce, ne přes celý týden. */
function DayColumn({
  date,
  blocks,
  pins,
  fromMin,
  drag,
  onOpen,
  onPlanPin,
}: {
  date: ISODate;
  blocks: TimeBlock[];
  pins: DuePin[];
  fromMin: number;
  drag: BlockDragApi;
  onOpen: (block: TimeBlock) => void;
  onPlanPin: (pin: DuePin) => void;
}) {
  const pinById = new Map(pins.map((p) => [`${PIN_PREFIX}${p.todo.id}`, p]));
  const preview = drag.drag;

  /* Do rozvržení jde tažený blok se svým náhledovým časem, aby si pod prstem
     rovnou udělal místo mezi ostatními. */
  const items = blocks.map((b) =>
    preview?.id === b.id ? { ...b, date, start: preview.start, duration: preview.duration } : b,
  );
  const layout = layoutDay([...items, ...pins.map(pinBlock)]);

  return (
    <>
      {layout.map(({ block, column, columns }) => {
        const gap = columns > 1 ? 2 : 0;
        const left = `calc(${(column * 100) / columns}% + ${column > 0 ? gap : 1}px)`;
        const width = `calc(${100 / columns}% - ${gap + 2}px)`;
        const pin = pinById.get(block.id);
        const top = (block.start - fromMin) * WEEK_PX_PER_MIN;
        const height = Math.max(16, block.duration * WEEK_PX_PER_MIN - 2);

        if (pin) {
          return (
            <PinCard
              key={block.id}
              pin={pin}
              top={top}
              height={height}
              left={left}
              width={width}
              compact
              onPlan={() => onPlanPin(pin)}
            />
          );
        }
        return (
          <BlockCard
            key={block.id}
            block={block}
            top={top}
            height={height}
            left={left}
            width={width}
            dragging={preview?.id === block.id}
            compact
            drag={drag}
            onOpen={() => onOpen(block)}
          />
        );
      })}
    </>
  );
}

function DayHead({ date, today, count }: { date: ISODate; today: ISODate; count: number }) {
  const isToday = date === today;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5">
      <span className={cn(
        "text-[10px] uppercase leading-none",
        isToday ? "text-primary font-medium" : "text-muted-foreground"
      )}>
        {DAY_SHORT[fromISODate(date).getDay()]}
      </span>
      <span
        className={cn(
          "tabular grid size-8 place-items-center rounded-full text-[14px] leading-none",
          isToday ? "bg-primary font-semibold text-primary-foreground" : "font-medium text-foreground",
        )}
      >
        {dayOfMonth(date)}
      </span>
      <span
        aria-hidden
        className={cn("size-1 rounded-full", count > 0 ? "bg-muted-foreground/50" : "bg-transparent")}
      />
    </div>
  );
}

function EdgeButton({ dir, onClick }: { dir: "up" | "down"; onClick: () => void }) {
  const Icon = dir === "up" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "up" ? "Ukázat dřívější hodiny" : "Ukázat pozdější hodiny"}
      className={cn(
        "flex w-full items-center justify-center py-1 text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground",
        dir === "up" ? "border-b" : "border-t",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
