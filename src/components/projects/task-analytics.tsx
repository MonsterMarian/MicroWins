"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntityIcon } from "@/components/ui/icon-picker";
import { ProgressAreaChart } from "@/components/charts/area-chart";
import { Ring } from "@/components/charts/ring";
import { useStore } from "@/components/providers/store-provider";
import { useGoUp } from "@/components/providers/use-app-back";
import { dayShort, formatDate } from "@/lib/date";
import {
  displayPercent,
  subtaskCounts,
  taskDailyChanges,
  taskDayRing,
  taskProgressSeries,
  taskStats,
} from "@/lib/projects";
import { cn, formatNumber, formatTenth, plural } from "@/lib/utils";

/**
 * Statistiky jednoho úkolu - stejná obrazovka jako u projektu, jen počítaná
 * z historie úkolu. Graf v detailu úkolu dřív vedl na statistiky celého
 * projektu, takže úkol ukazoval průměr všech úkolů, se kterými v projektu leží.
 */
export function TaskAnalytics({ taskId }: { taskId: string }) {
  const { state, today, hydrated } = useStore();
  const goUp = useGoUp();

  const stats = taskStats(state, taskId, today);
  const series = React.useMemo(
    () => taskProgressSeries(state, taskId, today),
    [state, taskId, today],
  );
  const changes = React.useMemo(
    () => taskDailyChanges(state, taskId, today),
    [state, taskId, today],
  );

  if (!hydrated) return <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />;

  if (!stats) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium">Úkol neexistuje</p>
          <Link href="/" className="text-sm text-muted-foreground underline">
            Zpět na seznam
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { task } = stats;
  const days = taskDayRing(stats);
  /* Třetí kolečko je u projektu "Hotové úkoly". Úkol s podúkoly má obdobu
     v podúkolech, samostatný úkol v hodnotě - 630 z 2 000. */
  const counts = subtaskCounts(state, task.id);
  const hasSubtasks = counts.total > 0;
  const best = changes.reduce<number>((m, c) => Math.max(m, c.delta), 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zpět na úkol"
          onClick={() => goUp(`/tasks?id=${task.id}`)}
        >
          <ArrowLeft />
        </Button>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-lg">
          <EntityIcon icon={task.icon} size="lg" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{task.name}</h1>
          <p className="text-xs text-muted-foreground">Statistiky úkolu</p>
        </div>
      </header>

      <Card>
        <CardContent className="grid grid-cols-3 items-start gap-2 p-4 sm:gap-6 sm:p-6">
          <Ring value={stats.percent} label="Postup">
            <span className="tabular text-base font-semibold sm:text-lg">
              {displayPercent(stats.percent)} %
            </span>
          </Ring>
          <Ring value={days.value} label="Dny">
            <div className="flex flex-col items-center leading-none">
              <span className="tabular text-base font-semibold sm:text-lg">{days.days}</span>
              {days.total ? (
                <span className="tabular text-[10px] text-muted-foreground">z {days.total}</span>
              ) : null}
            </div>
          </Ring>
          {hasSubtasks ? (
            <Ring value={(counts.done / counts.total) * 100} label="Hotové podúkoly">
              <Fraction done={String(counts.done)} total={String(counts.total)} />
            </Ring>
          ) : (
            <Ring value={stats.percent} label={task.unit ? `Hotovo (${task.unit})` : "Hotovo"}>
              <Fraction done={formatNumber(task.current)} total={formatNumber(task.target)} />
            </Ring>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vývoj postupu</CardTitle>
          <CardDescription>
            Procenta den po dni. Dny bez zápisu drží poslední známou hodnotu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProgressAreaChart points={series} label="Vývoj postupu úkolu v procentech" />
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatDate(series[0]?.date ?? today)}</span>
            <span>—</span>
            <span>{formatDate(today)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <CardTitle>Deník změn</CardTitle>
              <CardDescription>
                {changes.length} {plural(changes.length, "změna", "změny", "změn")}
                {best > 0 ? ` · nejlepší den +${formatTenth(best)} %` : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {changes.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              {hasSubtasks
                ? "Zatím žádná změna. Posuň některý podúkol a den se sem zapíše."
                : "Zatím žádná změna. Posuň úkol a den se sem zapíše."}
            </p>
          ) : (
            <ul className="divide-y">
              {changes.map((c) => (
                <li key={c.date} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-32 shrink-0 text-sm font-medium">
                    {formatDate(c.date)}{" "}
                    <span className="text-muted-foreground">({dayShort(c.date)})</span>
                  </span>
                  <span className="tabular flex-1 text-sm text-muted-foreground">
                    {displayPercent(c.from)} % → <span className="font-medium text-foreground">{displayPercent(c.to)} %</span>
                  </span>
                  <span
                    className={cn(
                      "tabular inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                      c.delta > 0
                        ? "border-progress/40 bg-progress-muted/40 text-progress-muted-foreground"
                        : "border-destructive/40 text-destructive",
                    )}
                  >
                    {c.delta > 0 ? (
                      <TrendingUp className="size-3" />
                    ) : (
                      <TrendingDown className="size-3" />
                    )}
                    {c.delta > 0 ? "+" : ""}
                    {formatTenth(c.delta)} %
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Hotovo nad čarou, celek pod ní - stejně jako "Hotové úkoly" u projektu. */
function Fraction({ done, total }: { done: string; total: string }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="tabular text-base font-semibold sm:text-lg">{done}</span>
      <span className="my-0.5 h-px w-5 bg-border" />
      <span className="tabular text-sm text-muted-foreground">{total}</span>
    </div>
  );
}
