"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  clampStart,
  DEFAULT_DURATION,
  formatMinutes,
  layoutDay,
  snapMinutes,
  type DuePin,
} from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BlockCard, PinCard } from "./block-card";
import { pinBlock, PIN_PREFIX, useGridRange } from "./grid";
import { useBlockDrag } from "./use-block-drag";

/** Kolik pixelů zabere minuta. Hodina = 90 px, čtvrthodina = 22 px. */
export const DAY_PX_PER_MIN = 1.5;

/** Sloupec s hodinami vlevo. Široký přesně tolik, aby se do něj vešlo "23:00". */
const GUTTER = 42;

/**
 * Osa dne - jeden den odshora dolů.
 *
 * Hodiny drží jen vlasové linky a popisky v postranním sloupci; půlhodiny se
 * nekreslí. Mřížka po čtvrthodinách by z plánu udělala tabulku, a přitom se
 * na čtvrthodiny zarovnává tah sám, takže ji není potřeba vidět.
 *
 * Uplynulá část dne je podmalovaná a čára "teď" je tenká a neutrální. Červená
 * ani jantarová se sem nehodí: jantar patří microwinům a červená v téhle appce
 * znamená průšvih, ne "je půl jedenácté".
 */
export function DayView({
  date,
  blocks,
  pins,
  isToday,
  nowMinutes,
  gridRef,
  onPick,
  onOpen,
  onPlanPin,
}: {
  date: string;
  blocks: TimeBlock[];
  pins: DuePin[];
  isToday: boolean;
  nowMinutes: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onPick: (start: number) => void;
  onOpen: (block: TimeBlock) => void;
  onPlanPin: (pin: DuePin) => void;
}) {
  const drag = useBlockDrag({ pxPerMin: DAY_PX_PER_MIN });
  const range = useGridRange(blocks, pins, date);
  const { fromHour, toHour, fromMin, extendEarly, extendLate } = range;
  const height = (toHour - fromHour) * 60 * DAY_PX_PER_MIN;
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);

  const layout = React.useMemo(
    () => layoutDay([...blocks, ...pins.map(pinBlock)]),
    [blocks, pins],
  );
  const pinById = React.useMemo(
    () => new Map(pins.map((p) => [`${PIN_PREFIX}${p.todo.id}`, p])),
    [pins],
  );

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const minutes = fromMin + (e.clientY - rect.top) / DAY_PX_PER_MIN;
    onPick(clampStart(snapMinutes(minutes), DEFAULT_DURATION));
  };

  return (
    <Card className="overflow-hidden p-0 shrink-0">
      {fromHour > 0 ? <EdgeButton dir="up" onClick={extendEarly} /> : null}

      <div
        ref={gridRef}
        data-from-min={fromMin}
        className="relative"
        style={{ height }}
        onClick={pick}
      >
        {/* Uplynulá část dne. Jen podmalovaná, ať je vidět, kolik dne zbývá. */}
        {isToday && nowMinutes > fromMin ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 bg-muted/30"
            style={{ height: Math.min(height, (nowMinutes - fromMin) * DAY_PX_PER_MIN) }}
          />
        ) : null}

        {hours.map((hour, i) => (
          <div
            key={hour}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-border/60"
            style={{ top: i * 60 * DAY_PX_PER_MIN }}
          >
            <span className="tabular absolute -top-[7px] left-0 w-9 text-right text-[11px] leading-none text-muted-foreground/70">
              {hour}
            </span>
          </div>
        ))}

        {/* Svislá linka odděluje sloupec hodin od plochy dne. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-l border-border/60"
          style={{ left: GUTTER - 8 }}
        />

        <div className="absolute inset-y-0" style={{ left: GUTTER, right: 6 }}>
          {layout.map(({ block, column, columns }) => {
            const gap = columns > 1 ? 3 : 0;
            const left = `calc(${(column * 100) / columns}% + ${column > 0 ? gap : 0}px)`;
            const width = `calc(${100 / columns}% - ${gap}px)`;
            const pin = pinById.get(block.id);
            const preview = drag.drag?.id === block.id ? drag.drag : null;
            const start = preview?.start ?? block.start;
            const duration = preview?.duration ?? block.duration;
            const top = (start - fromMin) * DAY_PX_PER_MIN;
            const px = Math.max(20, duration * DAY_PX_PER_MIN - 2);

            if (pin) {
              return (
                <PinCard
                  key={block.id}
                  pin={pin}
                  top={top}
                  height={px}
                  left={left}
                  width={width}
                  onPlan={() => onPlanPin(pin)}
                />
              );
            }
            return (
              <BlockCard
                key={block.id}
                block={block}
                top={top}
                height={px}
                left={left}
                width={width}
                dragging={preview !== null}
                drag={drag}
                onOpen={() => onOpen(block)}
              />
            );
          })}

          {isToday && nowMinutes >= fromMin && nowMinutes <= toHour * 60 ? (
            <NowLine top={(nowMinutes - fromMin) * DAY_PX_PER_MIN} minutes={nowMinutes} />
          ) : null}
        </div>

        {blocks.length === 0 && pins.length === 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center gap-1 px-6 text-center">
            <p className="text-sm font-medium">Den je zatím prázdný</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Ťukni do mřížky na hodinu, kterou chceš zabrat - nebo si vezmi něco z pásu nahoře.
            </p>
          </div>
        ) : null}
      </div>

      {toHour < 24 ? <EdgeButton dir="down" onClick={extendLate} /> : null}
    </Card>
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
        "flex w-full items-center justify-center py-1.5 text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground",
        dir === "up" ? "border-b" : "border-t",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Tenká čára s tečkou a časem v postranním sloupci. */
function NowLine({ top, minutes }: { top: number; minutes: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="relative border-t-2 border-red-500">
        <span className="absolute -left-1.5 -top-[5px] size-2.5 rounded-full bg-red-500" />
        <span className="tabular absolute -left-[42px] -top-[7px] w-9 text-right text-[11px] font-bold leading-none text-red-500">
          {formatMinutes(minutes)}
        </span>
      </div>
    </div>
  );
}
