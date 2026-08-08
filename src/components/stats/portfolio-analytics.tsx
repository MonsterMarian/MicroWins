"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyBarChart } from "@/components/charts/bar-chart";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { displayPercent, portfolioActivity, portfolioStats, projectStats } from "@/lib/projects";
import { cn, formatTenth, plural } from "@/lib/utils";

/** Projektová část analýzy - postup napříč projekty a denní tempo. */
export function PortfolioAnalytics() {
  const { state, today } = useStore();
  const p = React.useMemo(() => portfolioStats(state, today), [state, today]);
  const activity = React.useMemo(() => portfolioActivity(state, 30, today), [state, today]);

  const rows = React.useMemo(
    () =>
      state.projects
        .filter((x) => x.archivedAt === null)
        .map((project) => projectStats(state, project.id, today)!)
        .sort((a, b) => b.percent - a.percent),
    [state, today],
  );

  if (state.projects.length === 0) return null;

  const activeDays = activity.filter((a) => a.gain > 0).length;
  const totalGain = formatTenth(activity.reduce((s, a) => s + a.gain, 0));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Tempo projektů</CardTitle>
          <CardDescription>
            Přírůstek procentních bodů za posledních 30 dní · {activeDays}{" "}
            {plural(activeDays, "aktivní den", "aktivní dny", "aktivních dní")} · celkem +{totalGain}{" "}
            b.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DailyBarChart points={activity.map((a) => ({ date: a.date, value: a.gain }))} unit=" b." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Postup projektů</CardTitle>
          <CardDescription>
            {p.activeProjects} rozpracovaných, {p.doneProjects} hotových · {p.tasksDone} z{" "}
            {p.tasksTotal} úkolů
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.map((s) => (
            <Link
              key={s.project.id}
              href={`/projects?id=${s.project.id}`}
              className="flex flex-col gap-1 rounded-md px-1 py-1 hover:bg-accent/50"
            >
              <div className="flex items-center gap-2">
                <span>{s.project.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{s.project.name}</span>
                {s.deltaToday > 0.05 ? (
                  <span className="tabular text-xs text-progress">
                    +{formatTenth(s.deltaToday)} b. dnes
                  </span>
                ) : null}
                <span
                  className={cn(
                    "tabular w-12 text-right text-sm font-medium",
                    s.overdue && "text-destructive",
                  )}
                >
                  {displayPercent(s.percent)} %
                </span>
              </div>
              <ProgressBar value={s.percent} size="sm" />
              <p className="text-[11px] text-muted-foreground">
                {formatDate(s.project.startDate)}
                {s.project.deadline ? ` - ${formatDate(s.project.deadline)}` : ""}
                {s.daysLeft !== null
                  ? s.daysLeft >= 0
                    ? ` · zbývá ${s.daysLeft} ${plural(s.daysLeft, "den", "dny", "dní")}`
                    : ` · ${-s.daysLeft} ${plural(-s.daysLeft, "den", "dny", "dní")} po termínu`
                  : ""}
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
