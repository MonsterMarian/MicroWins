"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { formatDate, monthShort } from "@/lib/date";
import { heatmap } from "@/lib/stats";
import { cn, plural } from "@/lib/utils";

const LEVELS = [
  "bg-muted",
  "bg-win/30",
  "bg-win/55",
  "bg-win/80",
  "bg-win",
] as const;

function level(count: number): string {
  if (count <= 0) return LEVELS[0];
  return LEVELS[Math.min(count, LEVELS.length - 1)];
}

export function Heatmap({ weeks = 18 }: { weeks?: number }) {
  const { state, today } = useStore();
  const grid = React.useMemo(() => heatmap(state, today, weeks), [state, today, weeks]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kalendář microwinů</CardTitle>
        <CardDescription>Posledních {weeks} týdnů. Sytější políčko = víc microwinů.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="flex gap-1">
          <div className="mr-1 flex flex-col gap-1 pt-[18px] text-[10px] leading-none text-muted-foreground">
            {["po", "", "st", "", "pá", "", "ne"].map((d, i) => (
              <span key={i} className="flex h-3 items-center">
                {d}
              </span>
            ))}
          </div>

          {grid.map((column, wi) => {
            const first = column[0];
            const showMonth =
              wi === 0 || monthShort(first.date) !== monthShort(grid[wi - 1][0].date);
            return (
              <div key={first.date} className="flex flex-col gap-1">
                <span className="h-[14px] text-[10px] leading-none text-muted-foreground">
                  {showMonth ? monthShort(first.date) : ""}
                </span>
                {column.map((cell) => (
                  <span
                    key={cell.date}
                    title={`${formatDate(cell.date)} · ${cell.count} ${plural(cell.count, "microwin", "microwiny", "microwinů")}`}
                    className={cn(
                      "size-3 rounded-[3px]",
                      cell.future ? "bg-transparent" : level(cell.count),
                      cell.date === today && "ring-1 ring-foreground/40 ring-offset-1 ring-offset-card",
                    )}
                  />
                ))}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          méně
          {LEVELS.map((l) => (
            <span key={l} className={cn("size-3 rounded-[3px]", l)} />
          ))}
          více
        </div>
      </CardContent>
    </Card>
  );
}
