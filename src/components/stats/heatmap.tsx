"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { dayName, formatDate, formatDateRelative, monthShort, yearOf } from "@/lib/date";
import { activeYears, dayRows, winDetail, yearHeatmap } from "@/lib/stats";
import type { ISODate } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

const LEVELS = ["bg-muted", "bg-win/30", "bg-win/55", "bg-win/80", "bg-win"] as const;

function level(count: number): string {
  if (count <= 0) return LEVELS[0];
  return LEVELS[Math.min(count, LEVELS.length - 1)];
}

/**
 * Kalendář microwinů po jednotlivých letech.
 *
 * Rok se na displej nevejde, tak se mřížka při otevření sama posune na dnešek
 * (u minulých roků na začátek) - do Analýzy se chodí kvůli "jak jsem na tom
 * teď", ne kvůli lednu.
 */
export function Heatmap() {
  const { state, today } = useStore();
  const [year, setYear] = React.useState(() => yearOf(today));
  const [selected, setSelected] = React.useState<ISODate | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const todayCell = React.useRef<HTMLButtonElement>(null);

  const years = React.useMemo(() => activeYears(state, today), [state, today]);
  const grid = React.useMemo(() => yearHeatmap(state, year, today), [state, year, today]);
  const rows = React.useMemo(() => dayRows(state), [state]);

  const first = years[0];
  const last = years[years.length - 1];
  const inYear = React.useMemo(
    () => rows.filter((r) => yearOf(r.date) === year).reduce((sum, r) => sum + r.count, 0),
    [rows, year],
  );

  React.useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const cell = todayCell.current;
    box.scrollTo({
      left: cell ? cell.offsetLeft - (box.clientWidth - cell.offsetWidth) / 2 : 0,
      behavior: "instant",
    });
  }, [year, grid]);

  // Detail patří k vybranému dni; po přepnutí roku by ukazoval jinam.
  React.useEffect(() => setSelected(null), [year]);

  const detail = selected ? (rows.find((r) => r.date === selected) ?? null) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle>Kalendář microwinů</CardTitle>
            <CardDescription>
              Leden až prosinec. Sytější políčko = víc microwinů. Klikni na den pro detail.
            </CardDescription>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Předchozí rok"
              disabled={year <= first}
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="tabular w-11 text-center text-sm font-medium">{year}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Následující rok"
              disabled={year >= last}
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div ref={scroller} className="scroll-quiet flex w-full gap-[3px] overflow-x-auto pb-1">
          <div className="mr-1 flex flex-col gap-[3px] pt-[18px] text-[10px] leading-none text-muted-foreground">
            {["po", "", "st", "", "pá", "", "ne"].map((d, i) => (
              <span key={i} className="flex h-3 items-center">
                {d}
              </span>
            ))}
          </div>

          {grid.map((column, wi) => {
            // Popisek měsíce patří k prvnímu týdnu, který do něj spadá.
            const anchor = column.find((c) => !c.outside) ?? column[0];
            const previous = wi > 0 ? grid[wi - 1].find((c) => !c.outside) : undefined;
            const showMonth =
              !anchor.outside && (!previous || monthShort(anchor.date) !== monthShort(previous.date));

            return (
              <div key={column[0].date} className="flex flex-col gap-[3px]">
                {/* w-3: popisek měsíce nesmí rozšířit sloupec, přetéká přes sousední týdny */}
                <span className="h-[14px] w-3 whitespace-nowrap text-[10px] leading-none text-muted-foreground">
                  {showMonth ? monthShort(anchor.date) : ""}
                </span>
                {column.map((cell) =>
                  cell.outside || cell.future ? (
                    <span key={cell.date} className="size-3 rounded-[3px] bg-transparent" />
                  ) : (
                    <button
                      key={cell.date}
                      ref={cell.date === today ? todayCell : undefined}
                      type="button"
                      aria-pressed={cell.date === selected}
                      onClick={() => setSelected((s) => (s === cell.date ? null : cell.date))}
                      title={`${formatDate(cell.date)} · ${cell.count} ${plural(cell.count, "microwin", "microwiny", "microwinů")}`}
                      className={cn(
                        "size-3 rounded-[3px] transition-shadow hover:ring-1 hover:ring-foreground/40",
                        level(cell.count),
                        cell.date === today &&
                          "ring-1 ring-foreground/40 ring-offset-1 ring-offset-card",
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
          <span className="tabular ml-auto">
            {year}: {inYear} {plural(inYear, "microwin", "microwiny", "microwinů")}
          </span>
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
              <span className="text-xs text-muted-foreground">{winDetail(item)}</span>
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
