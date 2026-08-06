"use client";

import * as React from "react";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";

export interface BarPoint {
  date: string;
  value: number;
}

/**
 * Denní sloupce jedné veličiny (přírůstek procentních bodů).
 * Jedna řada = bez legendy; hodnota se ukazuje na hover.
 */
export function DailyBarChart({
  points,
  height = 120,
  unit = "",
  className,
}: {
  points: BarPoint[];
  height?: number;
  unit?: string;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));

  if (points.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max(3, (p.value / max) * height) : 2;
          return (
            <button
              key={p.date}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${formatDate(p.date)}: ${p.value}${unit}`}
              className="group relative flex-1 rounded-t-[3px] transition-colors"
              style={{ height: h, minWidth: 4 }}
            >
              <span
                className={cn(
                  "absolute inset-0 rounded-t-[3px]",
                  p.value > 0 ? "bg-progress" : "bg-track",
                  hover === i && "bg-progress-muted-foreground",
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatDate(points[0].date)}</span>
        <span className="tabular">
          {hover !== null
            ? `${formatDate(points[hover].date)} · ${points[hover].value}${unit}`
            : `max ${Math.round(max * 10) / 10}${unit}`}
        </span>
        <span>{formatDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}
