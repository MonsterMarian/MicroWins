"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntityIcon } from "@/components/ui/icon-picker";
import { ProgressAreaChart } from "@/components/charts/area-chart";
import { Ring } from "@/components/charts/ring";
import { useStore } from "@/components/providers/store-provider";
import { dayShort, formatDate } from "@/lib/date";
import {
  dailyChanges,
  dayRing,
  displayPercent,
  progressSeries,
  projectById,
  projectStats,
} from "@/lib/projects";
import { cn, formatTenth, plural } from "@/lib/utils";

export function ProjectAnalytics({ projectId }: { projectId: string }) {
  const { state, today, hydrated } = useStore();
  const router = useRouter();

  const project = projectById(state, projectId);
  const stats = projectStats(state, projectId, today);
  const series = React.useMemo(
    () => progressSeries(state, projectId, today),
    [state, projectId, today],
  );
  const changes = React.useMemo(
    () => dailyChanges(state, projectId, today),
    [state, projectId, today],
  );

  if (!hydrated) return <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />;

  if (!project || !stats) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium">Projekt neexistuje</p>
          <Link href="/" className="text-sm text-muted-foreground underline">
            Zpět na seznam
          </Link>
        </CardContent>
      </Card>
    );
  }

  const days = dayRing(stats);
  const taskRingValue = stats.tasksTotal > 0 ? (stats.tasksDone / stats.tasksTotal) * 100 : 0;
  const best = changes.reduce<number>((m, c) => Math.max(m, c.delta), 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zpět"
          onClick={() => router.push(`/projects?id=${projectId}`)}
        >
          <ArrowLeft />
        </Button>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-lg">
          <EntityIcon icon={project.icon} size="lg" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-muted-foreground">Statistiky projektu</p>
        </div>
      </header>

      <Card>
        {/*
         * Tři kolečka vždy vedle sebe. Zalamování je pouštělo na telefonu do
         * dvou řad (3 × 104 px se do 375 px nevejde) a z trojice čísel, která
         * se mají číst naráz, byl schod. Místo zalomení se proto zmenší samy:
         * mřížka o třech stejných sloupcích a poloměr podle šířky okna.
         */}
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
          <Ring value={taskRingValue} label="Hotové úkoly">
            <div className="flex flex-col items-center leading-none">
              <span className="tabular text-base font-semibold sm:text-lg">{stats.tasksDone}</span>
              <span className="my-0.5 h-px w-5 bg-border" />
              <span className="tabular text-sm text-muted-foreground">{stats.tasksTotal}</span>
            </div>
          </Ring>
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
          <ProgressAreaChart points={series} />
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatDate(project.startDate)}</span>
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
              Zatím žádná změna. Posuň libovolný úkol a den se sem zapíše.
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
