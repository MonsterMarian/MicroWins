"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { addDays, dayOfMonth, dayShort, formatDate } from "@/lib/date";
import { dayRows } from "@/lib/stats";
import { cn } from "@/lib/utils";

/** Kompaktní pruh posledních 14 dní - rychlý pohled na sérii. */
export function LastDaysStrip({ days = 14 }: { days?: number }) {
  const { state, today } = useStore();
  const rows = React.useMemo(() => {
    const map = new Map(dayRows(state).map((r) => [r.date, r.count]));
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(today, -(days - 1 - i));
      return { date, count: map.get(date) ?? 0 };
    });
  }, [state, today, days]);

  return (
    <div className="flex gap-1 overflow-x-auto">
      {rows.map((r) => (
        <div
          key={r.date}
          className={cn(
            "flex min-w-9 flex-1 flex-col items-center gap-0.5 rounded-md border p-1.5",
            r.count > 0 ? "border-win/40 bg-win-muted/50" : "bg-muted/30",
            r.date === today && "ring-1 ring-foreground/30",
          )}
          title={`${formatDate(r.date)} · ${r.count}`}
        >
          <span className="text-[10px] text-muted-foreground">{dayShort(r.date)}</span>
          <span className="tabular text-sm font-medium">{r.count || "·"}</span>
          <span className="tabular text-[10px] leading-none text-muted-foreground/70">
            {dayOfMonth(r.date)}.
          </span>
        </div>
      ))}
    </div>
  );
}
