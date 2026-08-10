"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { displayPercent, isTaskDone, subtasksOf, taskPercent } from "@/lib/projects";
import type { Task } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

export function TaskRow({
  task,
  showProject,
  compact,
}: {
  task: Task;
  showProject?: string;
  compact?: boolean;
}) {
  const { state, today, adjustTask, toggleTaskDone } = useStore();
  const percent = taskPercent(state, task);
  const done = isTaskDone(state, task);
  const children = subtasksOf(state, task.id);
  const overdue = task.dueDate !== null && task.dueDate < today && !done;

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50">
      <button
        type="button"
        onClick={() => toggleTaskDone(task.id)}
        aria-label={done ? "Označit jako nedokončené" : "Označit jako hotové"}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg border text-sm transition-colors",
          done ? "border-progress bg-progress text-progress-foreground" : "bg-muted",
        )}
      >
        {done ? <Check className="size-4" /> : <EntityIcon icon={task.icon} size="sm" />}
      </button>

      <Link href={`/tasks?id=${task.id}`} className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>
          {task.name}
        </div>
        {!compact ? (
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="tabular">
              {formatNumber(task.current)} / {formatNumber(task.target)}
              {task.unit ? ` ${task.unit}` : ""}
            </span>
            {children.length > 0 ? <span>· {children.length} podúkolů</span> : null}
            {task.dueDate ? (
              <span className={cn(overdue && "text-destructive")}>
                · termín {formatDate(task.dueDate)}
              </span>
            ) : null}
            {showProject ? <span>· {showProject}</span> : null}
          </div>
        ) : null}
      </Link>

      {children.length === 0 ? (
        <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ubrat krok"
            onClick={() => adjustTask(task.id, -task.step)}
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Přidat krok"
            onClick={() => adjustTask(task.id, task.step)}
          >
            <Plus />
          </Button>
        </div>
      ) : null}

      <div className="w-20 shrink-0 sm:w-28">
        <ProgressBar value={percent} size="lg" />
      </div>

      <span
        className={cn(
          "tabular w-11 shrink-0 text-right text-sm font-semibold",
          done ? "text-progress" : "text-progress-muted-foreground",
        )}
      >
        {displayPercent(percent)} %
      </span>
    </div>
  );
}
