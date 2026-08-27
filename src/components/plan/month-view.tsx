"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { type DuePin } from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";
import { useStore } from "@/components/providers/store-provider";
import { blocksOfDay, pinsOfDay } from "@/lib/timeblocks";
import { fromISODate, monthDays, DAY_SHORT, weekdayMondayFirst, addDays, toISODate } from "@/lib/date";
import type { ISODate } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MonthView({
  date,
  today,
  onPick,
}: {
  date: ISODate;
  today: ISODate;
  onPick: (date: ISODate) => void;
}) {
  const { state } = useStore();
  const days = monthDays(date);
  
  // Pad the start with previous month days to start on Monday
  const firstDay = days[0];
  const offset = weekdayMondayFirst(firstDay);
  const paddedDays: ISODate[] = [];
  for (let i = offset; i > 0; i--) {
    paddedDays.push(addDays(firstDay, -i));
  }
  paddedDays.push(...days);
  
  // Pad the end to complete the grid (6 rows of 7 days = 42 cells)
  const remaining = 42 - paddedDays.length;
  const lastDay = days[days.length - 1];
  for (let i = 1; i <= remaining; i++) {
    paddedDays.push(addDays(lastDay, i));
  }

  // Days of week header (Mo, Tu, We...)
  const dayNames = [1, 2, 3, 4, 5, 6, 0].map(d => DAY_SHORT[d]);

  return (
    <Card className="overflow-hidden p-0 flex flex-col">
      <div className="grid grid-cols-7 border-b border-border/50 bg-muted/20">
        {dayNames.map((name, i) => (
          <div key={i} className="py-2 text-center text-[10px] uppercase font-semibold text-muted-foreground">
            {name}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {paddedDays.map((d, i) => {
          const isCurrentMonth = d.slice(0, 7) === date.slice(0, 7);
          const isToday = d === today;
          const blocks = blocksOfDay(state, d);
          const pins = pinsOfDay(state, d);
          const load = blocks.length + pins.length;
          
          return (
            <div
              key={d}
              onClick={() => onPick(d)}
              className={cn(
                "min-h-[80px] border-b border-r border-border/50 p-1 flex flex-col gap-1 cursor-pointer transition-colors hover:bg-accent/50",
                !isCurrentMonth && "bg-muted/10 opacity-50 text-muted-foreground",
                (i + 1) % 7 === 0 && "border-r-0"
              )}
            >
              <div className="flex justify-center">
                <span className={cn(
                  "tabular grid size-7 place-items-center rounded-full text-[13px] leading-none",
                  isToday ? "bg-primary font-semibold text-primary-foreground" : "font-medium text-foreground"
                )}>
                  {fromISODate(d).getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-[2px] mt-1 overflow-hidden">
                {blocks.slice(0, 3).map(b => (
                  <div key={b.id} className="h-1.5 w-full bg-primary/70 rounded-full" />
                ))}
                {blocks.length > 3 && (
                  <div className="text-[9px] text-muted-foreground text-center font-medium leading-none mt-0.5">
                    +{blocks.length - 3}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
