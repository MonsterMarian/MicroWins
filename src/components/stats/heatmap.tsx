"use client";

import * as React from "react";
import { Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { dayName, formatDate, formatDateRelative, monthShort } from "@/lib/date";
import { dayRows, heatmap, winDetail } from "@/lib/stats";
import type { ISODate } from "@/lib/types";
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

export function Heatmap({ weeks = 53 }: { weeks?: number }) {
  const { state, today } = useStore();
  const grid = React.useMemo(() => heatmap(state, today, weeks), [state, today, weeks]);
  const rows = React.useMemo(() => dayRows(state), [state]);
  const [selected, setSelected] = React.useState<ISODate | null>(null);

  const detail = selected ? rows.find((r) => r.date === selected) ?? null : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kalendář microwinů</CardTitle>
        <CardDescription>
          Posledních {weeks} týdnů. Sytější políčko = víc microwinů. Klikni na den pro detail.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="scroll-quiet flex w-full gap-[3px] overflow-x-auto pb-1">
          <div className="mr-1 flex flex-col gap-[3px] pt-[18px] text-[10px] leading-none text-muted-foreground">
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
              <div key={first.date} className="flex flex-col gap-[3px]">
                {/* w-3: popisek měsíce nesmí rozšířit sloupec, přetéká přes sousední týdny */}
                <span className="h-[14px] w-3 whitespace-nowrap text-[10px] leading-none text-muted-foreground">
                  {showMonth ? monthShort(first.date) : ""}
                </span>
                {column.map((cell) =>
                  cell.future ? (
                    <span key={cell.date} className="size-3 rounded-[3px] bg-transparent" />
                  ) : (
                    <button
                      key={cell.date}
                      type="button"
                      aria-pressed={cell.date === selected}
                      onClick={() => setSelected((s) => (s === cell.date ? null : cell.date))}
                      title={`${formatDate(cell.date)} · ${cell.count} ${plural(cell.count, "microwin", "microwiny", "microwinů")}`}
                      className={cn(
                        "size-3 rounded-[3px] transition-shadow hover:ring-1 hover:ring-foreground/40",
                        level(cell.count),
                        cell.date === today && "ring-1 ring-foreground/40 ring-offset-1 ring-offset-card",
                        cell.date === selected &&
                          "ring-2 ring-foreground ring-offset-1 ring-offset-card",
                      )}
                    />
                  ),
                )}
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

        {selected ? <DayDetail date={selected} row={detail} today={today} /> : null}
      </CardContent>
    </Card>
  );
}

function DayDetail({
  date,
  row,
  today,
}: {
  date: ISODate;
  row: ReturnType<typeof dayRows>[number] | null;
  today: ISODate;
}) {
  const count = row?.count ?? 0;

  return (
    <div className="mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{formatDate(date)}</span>
        <span className="text-xs text-muted-foreground">
          {dayName(date)} · {formatDateRelative(date, today)}
        </span>
        <Badge variant={date === today ? "solid" : "default"} className="tabular ml-auto shrink-0">
          <Trophy /> {count}
        </Badge>
      </div>

      {row ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {row.items.map((item) => (
            <li key={item.microwin.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium">{item.text}</span>
              <span className="text-xs text-muted-foreground">
                {winDetail(item)}
              </span>
              {item.path ? (
                <span className="text-xs text-muted-foreground/80">· {item.path}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Tento den žádný microwin nepadl.</p>
      )}
    </div>
  );
}
