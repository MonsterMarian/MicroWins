"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { dayOfMonth, dayShort, formatDate, monthDays, monthLabel } from "@/lib/date";
import { dayRows } from "@/lib/stats";
import { cn, plural } from "@/lib/utils";

/**
 * Pruh dnů aktuálního měsíce.
 *
 * Celý měsíc se na displej nevejde, takže se pruh při otevření sám posune tak,
 * aby byl dnešek uprostřed - cílem je, aby uživatel po vstupu do Analýzy viděl
 * dnešek bez scrollování. Na začátku a na konci měsíce se posun zarazí o kraj,
 * dnešek je pak u okraje, ale pořád v obraze.
 */
export function MonthStrip() {
  const { state, today } = useStore();
  const scroller = React.useRef<HTMLDivElement>(null);
  const todayTile = React.useRef<HTMLDivElement>(null);

  const days = React.useMemo(() => {
    const map = new Map(dayRows(state).map((r) => [r.date, r.count]));
    return monthDays(today).map((date) => ({
      date,
      count: map.get(date) ?? 0,
      future: date > today,
    }));
  }, [state, today]);

  React.useEffect(() => {
    const box = scroller.current;
    const tile = todayTile.current;
    if (!box || !tile) return;
    // scrollTo se zarazí sám na 0 i na konci - kraje měsíce řešit netřeba.
    box.scrollTo({
      left: tile.offsetLeft - (box.clientWidth - tile.offsetWidth) / 2,
      behavior: "instant",
    });
  }, [today, days.length]);

  const done = days.filter((d) => d.count > 0).length;
  const total = days.reduce((sum, d) => sum + d.count, 0);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          Tento měsíc · {monthLabel(today)}
        </h2>
        <span className="tabular ml-auto text-xs text-muted-foreground">
          {done} {plural(done, "aktivní den", "aktivní dny", "aktivních dnů")} · {total}{" "}
          {plural(total, "microwin", "microwiny", "microwinů")}
        </span>
      </div>

      <div ref={scroller} className="scroll-quiet flex gap-1 overflow-x-auto pb-1">
        {days.map((d) => (
          <div
            key={d.date}
            ref={d.date === today ? todayTile : undefined}
            className={cn(
              "flex min-w-9 flex-1 flex-col items-center gap-0.5 rounded-md border p-1.5",
              d.count > 0 ? "border-win/40 bg-win-muted/50" : "bg-muted/30",
              // Dny, které teprve přijdou, drží místo, ale netváří se jako propásnuté.
              d.future && "border-dashed bg-transparent opacity-50",
              d.date === today && "ring-1 ring-foreground/30",
            )}
            title={`${formatDate(d.date)} · ${d.count}`}
          >
            <span className="text-[10px] text-muted-foreground">{dayShort(d.date)}</span>
            <span className="tabular text-sm font-medium">{d.count || "·"}</span>
            <span className="tabular text-[10px] leading-none text-muted-foreground/70">
              {dayOfMonth(d.date)}.
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
