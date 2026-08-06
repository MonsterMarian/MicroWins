"use client";

import * as React from "react";
import { Search, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { addDays, dayName, dayShort, formatDate, formatDateRelative } from "@/lib/date";
import { dayRows, type DayRow } from "@/lib/stats";
import { cn, formatNumber, plural } from "@/lib/utils";

/**
 * Část 2 zadání: tabulka dnů. U každého microwinu je text metriky,
 * kde je X nahrazeno hodnotou daného dne.
 */
export function DayTable() {
  const { state, today } = useStore();
  const [query, setQuery] = React.useState("");

  const rows = React.useMemo(() => dayRows(state), [state]);
  const filtered = React.useMemo<DayRow[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows
      .map((r) => ({
        ...r,
        items: r.items.filter(
          (i) =>
            i.text.toLowerCase().includes(q) ||
            i.path.toLowerCase().includes(q) ||
            formatDate(r.date).includes(q),
        ),
      }))
      .filter((r) => r.items.length > 0);
  }, [rows, query]);

  const shown = filtered.reduce((sum, r) => sum + r.items.length, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Dny s microwiny</CardTitle>
            <CardDescription>
              {shown} {plural(shown, "microwin", "microwiny", "microwinů")} · {filtered.length}{" "}
              {plural(filtered.length, "den", "dny", "dní")}
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat v microwinech"
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            {rows.length === 0
              ? "Zatím žádný microwin. Zapiš dnes něco většího, než býval tvůj rekord."
              : "Nic nesedí na hledaný výraz."}
          </p>
        ) : (
          <ul className="divide-y">
            {filtered.map((row) => (
              <li
                key={row.date}
                className={cn(
                  "flex flex-col gap-2 px-5 py-3 sm:flex-row sm:gap-4",
                  row.date === today && "bg-win-muted/30",
                )}
              >
                <div className="flex shrink-0 items-center gap-2 sm:w-40 sm:flex-col sm:items-start sm:gap-0.5">
                  <span className="text-sm font-medium">
                    {formatDate(row.date)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {dayName(row.date)} · {formatDateRelative(row.date, today)}
                  </span>
                </div>

                <Badge
                  variant={row.date === today ? "solid" : "default"}
                  className="tabular h-fit shrink-0"
                  title={`${row.count} ${plural(row.count, "microwin", "microwiny", "microwinů")}`}
                >
                  <Trophy /> {row.count}
                </Badge>

                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {row.items.map((item) => (
                    <li key={item.microwin.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{item.text}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.firstEver
                          ? "první zápis"
                          : `překonáno ${formatNumber(item.previousRecord)}`}
                      </span>
                      {item.path ? (
                        <span className="text-xs text-muted-foreground/80">· {item.path}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

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
            "flex min-w-9 flex-1 flex-col items-center gap-1 rounded-md border p-1.5",
            r.count > 0 ? "border-win/40 bg-win-muted/50" : "bg-muted/30",
            r.date === today && "ring-1 ring-foreground/30",
          )}
          title={`${formatDate(r.date)} · ${r.count}`}
        >
          <span className="text-[10px] text-muted-foreground">{dayShort(r.date)}</span>
          <span className="tabular text-sm font-medium">{r.count || "·"}</span>
        </div>
      ))}
    </div>
  );
}
