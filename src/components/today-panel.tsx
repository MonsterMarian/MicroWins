"use client";

import * as React from "react";
import { Flame, Plus, Target, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { EntryDialog } from "@/components/tree/entry-dialog";
import { dayName, formatDate } from "@/lib/date";
import { metricsOf, summarizeMetric } from "@/lib/domain";
import { dayRows, streaks } from "@/lib/stats";
import type { TreeNode } from "@/lib/types";
import { formatNumber, plural } from "@/lib/utils";

export function TodayPanel() {
  const { state, today } = useStore();
  const [entryFor, setEntryFor] = React.useState<TreeNode | null>(null);

  const streak = React.useMemo(() => streaks(state, today), [state, today]);
  const todayRow = React.useMemo(
    () => dayRows(state).find((r) => r.date === today) ?? null,
    [state, today],
  );

  // Metriky seřazené podle toho, jak blízko jsou dnes rekordu.
  const chase = React.useMemo(() => {
    return metricsOf(state.nodes)
      .map((metric) => summarizeMetric(state, metric, today))
      .filter((s) => !s.hasMicrowinToday)
      .sort((a, b) => {
        if (a.record.value === 0 || b.record.value === 0) {
          return Number(b.record.value === 0) - Number(a.record.value === 0);
        }
        return a.toRecord / a.record.value - b.toRecord / b.record.value;
      })
      .slice(0, 4);
  }, [state, today]);

  const count = todayRow?.count ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {dayName(today)} · {formatDate(today)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {count === 0
              ? "Dnes zatím žádný microwin"
              : `${count} ${plural(count, "microwin", "microwiny", "microwinů")} dnes`}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {streak.current > 0 ? (
            <Badge variant={streak.todayDone ? "solid" : "outline"} className="tabular">
              <Flame /> série {streak.current} {plural(streak.current, "den", "dny", "dní")}
            </Badge>
          ) : null}
          {streak.longest > 0 ? (
            <Badge variant="outline" className="tabular">
              rekordní série {streak.longest}
            </Badge>
          ) : null}
        </div>
      </div>

      {count > 0 ? (
        <ul className="flex flex-col gap-1 px-5 pb-4">
          {todayRow?.items.map((item) => (
            <li
              key={item.microwin.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-win-muted/60 px-3 py-2"
            >
              <Trophy className="size-4 shrink-0 text-win" />
              <span className="text-sm font-medium">{item.text}</span>
              <span className="text-xs text-muted-foreground">
                {item.firstEver
                  ? "první zápis"
                  : `předchozí rekord ${formatNumber(item.previousRecord)}`}
              </span>
              {item.path ? (
                <span className="ml-auto text-xs text-muted-foreground">{item.path}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {chase.length > 0 ? (
        <div className="border-t bg-muted/30 px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Target className="size-3.5" />
            {count === 0 ? "Co dnes zlomit" : "Ještě jde zlomit"}
          </p>
          <ul className="flex flex-col gap-1">
            {chase.map((s) => (
              <li key={s.metric.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 truncate">{s.metric.name}</span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {s.record.value === 0
                    ? "bez rekordu - stačí cokoliv > 0"
                    : `dnes ${formatNumber(s.todayTotal)} / rekord ${formatNumber(s.record.value)} · chybí ${formatNumber(s.toRecord)}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() => setEntryFor(s.metric)}
                >
                  <Plus /> Zápis
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <EntryDialog
        metric={entryFor}
        open={entryFor !== null}
        onOpenChange={(open) => !open && setEntryFor(null)}
      />
    </Card>
  );
}
