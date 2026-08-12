"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { AnimatedPercent, ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import {
  displayPercent,
  isBinaryTask,
  isTaskDone,
  subtasksOf,
  taskPercent,
  taskDeltaToday,
} from "@/lib/projects";
import type { Task } from "@/lib/types";
import { cn, formatNumber, formatTenth, plural } from "@/lib/utils";

/**
 * Řádek úkolu v seznamu. Schválně nic nepřepíná: dřív tu vlevo bylo
 * zaškrtávátko, které jedním ťuknutím vyhnalo úkol na sto procent - a protože
 * sedělo hned vedle názvu, spouštělo se hlavně omylem. Postup se teď mění
 * výhradně v detailu úkolu, řádek je jen cesta tam.
 */
export function TaskRow({
  task,
  showProject,
  compact,
}: {
  task: Task;
  showProject?: string;
  compact?: boolean;
}) {
  const { state, today } = useStore();
  const percent = taskPercent(state, task);
  const done = isTaskDone(state, task);
  const children = subtasksOf(state, task.id);
  const overdue = task.dueDate !== null && task.dueDate < today && !done;
  const deltaToday = taskDeltaToday(state, task, today);
  /* Cíl 1 bez podúkolů je jen "hotovo / nehotovo" - pruh ani "1 / 1" k tomu
     nic nedodají, takže zbyde samotný stav u ikony. */
  const binary = isBinaryTask(state, task);

  return (
    <Link
      href={`/tasks?id=${task.id}`}
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50 active:bg-accent"
    >
      <span
        className={cn(
          "relative grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-base transition-colors",
          done && "bg-progress-muted/60",
        )}
      >
        <EntityIcon icon={task.icon} size="lg" />
        {done ? (
          <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-progress text-progress-foreground ring-2 ring-card">
            <Check className="size-2.5" />
          </span>
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.name}
        </span>
        {!compact ? (
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {binary ? null : children.length > 0 ? (
              <span className="tabular">
                {children.filter((c) => isTaskDone(state, c)).length} / {children.length}{" "}
                {plural(children.length, "podúkol", "podúkoly", "podúkolů")}
              </span>
            ) : (
              <span className="tabular">
                {formatNumber(task.current)} / {formatNumber(task.target)}
                {task.unit ? ` ${task.unit}` : ""}
              </span>
            )}
            {task.dueDate ? (
              <span className={cn(overdue && "text-destructive")}>
                {binary ? "" : "· "}termín {formatDate(task.dueDate)}
              </span>
            ) : null}
            {showProject ? <span>· {showProject}</span> : null}
            {deltaToday > 0.05 ? (
              <span className="text-progress font-medium">· +{formatTenth(deltaToday)} % dnes</span>
            ) : null}
          </span>
        ) : null}
      </span>

      {binary ? (
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            done ? "text-progress" : "text-muted-foreground",
          )}
        >
          {done ? "hotovo" : "nehotovo"}
        </span>
      ) : (
        <>
          <span className="block w-16 shrink-0 sm:w-28">
            <ProgressBar value={percent} size="lg" />
          </span>

          <AnimatedPercent
            value={percent}
            format={displayPercent}
            className={cn(
              "w-11 shrink-0 text-right text-sm font-semibold",
              done ? "text-progress" : "text-progress-muted-foreground",
            )}
          />
        </>
      )}

      {/* Šipka místo zmizelého zaškrtávátka - řádek tím říká, že vede dál. */}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
