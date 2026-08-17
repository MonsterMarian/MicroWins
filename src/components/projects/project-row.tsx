"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { AnimatedPercent, ProgressBar, type ProgressTone } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { displayPercent, pace, projectStats, type Pace } from "@/lib/projects";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Barva pruhu podle tempa - zelená drží, dokud se projekt nezačne opožďovat. */
export const PACE_TONE: Record<Pace, ProgressTone> = {
  none: "progress",
  done: "progress",
  ahead: "progress",
  behind: "win",
  late: "destructive",
};

export function ProjectRow({ project }: { project: Project }) {
  const { state, today } = useStore();
  const stats = projectStats(state, project.id, today);
  if (!stats) return null;

  const done = stats.percent >= 100;
  const status = pace(stats);

  return (
    <Link
      href={`/projects?id=${project.id}`}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 active:bg-accent"
    >
      <span
        className={cn(
          "relative grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-lg transition-colors",
          done && "bg-progress-muted/60",
        )}
      >
        <EntityIcon icon={project.icon} size="lg" />
        {done ? (
          <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-progress text-progress-foreground ring-2 ring-card">
            <CheckCircle2 className="size-3" />
          </span>
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{project.name}</span>
          {stats.overdue ? (
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label="Po termínu" />
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {formatDate(project.startDate)}
          {project.deadline ? ` - ${formatDate(project.deadline)}` : " -"}
          {stats.daysLeft !== null
            ? ` · ${stats.daysLeft >= 0 ? `zbývá ${stats.daysLeft} dní` : `${-stats.daysLeft} dní po termínu`}`
            : ""}
        </span>
      </span>

      <span className="block w-16 shrink-0 sm:w-28">
        <ProgressBar value={stats.percent} size="lg" tone={PACE_TONE[status]} />
      </span>

      <AnimatedPercent
        value={stats.percent}
        format={displayPercent}
        className={cn(
          "w-12 shrink-0 text-right text-sm font-semibold",
          done ? "text-progress" : "text-progress-muted-foreground",
        )}
      />
    </Link>
  );
}
