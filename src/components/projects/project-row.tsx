"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { displayPercent, projectStats } from "@/lib/projects";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProjectRow({ project }: { project: Project }) {
  const { state, today } = useStore();
  const stats = projectStats(state, project.id, today);
  if (!stats) return null;

  const done = stats.percent >= 100;

  return (
    <Link
      href={`/projects?id=${project.id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-lg">
        {project.icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{project.name}</span>
          {done ? <CheckCircle2 className="size-3.5 shrink-0 text-progress" /> : null}
          {stats.overdue ? (
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label="Po termínu" />
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {formatDate(project.startDate)}
          {project.deadline ? ` - ${formatDate(project.deadline)}` : " -"}
          {stats.daysLeft !== null
            ? ` · ${stats.daysLeft >= 0 ? `zbývá ${stats.daysLeft} dní` : `${-stats.daysLeft} dní po termínu`}`
            : ""}
        </p>
      </div>

      <div className="hidden w-28 shrink-0 sm:block">
        <ProgressBar value={stats.percent} size="lg" tone={done ? "progress" : "progress"} />
      </div>

      <span
        className={cn(
          "tabular w-12 shrink-0 text-right text-sm font-semibold",
          done ? "text-progress" : "text-progress-muted-foreground",
        )}
      >
        {displayPercent(stats.percent)} %
      </span>
    </Link>
  );
}
