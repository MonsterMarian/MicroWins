"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { dayShort, formatDate } from "@/lib/date";
import { tapFeedback } from "@/lib/native";
import {
  DAY_MINUTES,
  DEFAULT_DURATION,
  DURATION_CHOICES,
  formatLength,
  formatMinutes,
  formatSpan,
  parseMinutes,
  TIMEBLOCK_MAX_TITLE,
  unplannedTasks,
  unplannedTodos,
} from "@/lib/timeblocks";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { taskOrigin } from "./queue";

/**
 * Zakládání i úprava bloku v jednom dialogu.
 *
 * Nový blok navíc nabídne, co je rozdělané - ťuknutí na položku ho rovnou
 * založí. Nejčastější případ je tím pádem dvě ťuknutí od začátku do konce:
 * do mřížky a na věc, která se má dělat.
 */
export function BlockDialog({
  block,
  date,
  start,
  onClose,
}: {
  block?: TimeBlock;
  date: ISODate;
  start?: number;
  onClose: () => void;
}) {
  const { state, addBlock, updateBlock, deleteBlock, restoreBlock } = useStore();
  const { toast } = useToast();

  const [title, setTitle] = React.useState(block?.title ?? "");
  const [time, setTime] = React.useState(() => padTime(block ? block.start : (start ?? 9 * 60)));
  const [duration, setDuration] = React.useState(block?.duration ?? DEFAULT_DURATION);
  const [day, setDay] = React.useState<ISODate>(block?.date ?? date);

  const linkedTask = block?.taskId ? state.tasks.find((t) => t.id === block.taskId) : undefined;
  const linkedTodo = block?.todoId ? state.todos.find((t) => t.id === block.todoId) : undefined;
  const linkedName = linkedTask?.name ?? linkedTodo?.text ?? "";

  const picks = React.useMemo(() => {
    if (block) return { todos: [], tasks: [] };
    return {
      todos: unplannedTodos(state, day).slice(0, 5),
      tasks: unplannedTasks(state, day).slice(0, 5),
    };
  }, [block, state, day]);

  const startMinutes = parseMinutes(time) ?? block?.start ?? start ?? 9 * 60;

  const save = () => {
    const trimmed = title.trim();
    if (block) {
      updateBlock(block.id, { title: trimmed, start: startMinutes, duration, date: day });
    } else {
      if (!trimmed) return;
      addBlock({ date: day, start: startMinutes, duration, title: trimmed });
    }
    void tapFeedback();
    onClose();
  };

  const pick = (input: { title: string; todoId?: string; taskId?: string }) => {
    addBlock({
      date: day,
      start: startMinutes,
      duration,
      title: input.title,
      todoId: input.todoId ?? null,
      taskId: input.taskId ?? null,
    });
    void tapFeedback();
    onClose();
  };

  const remove = () => {
    if (!block) return;
    const removed = deleteBlock(block.id);
    onClose();
    if (!removed) return;
    toast({
      tone: "info",
      title: "Blok smazán",
      description: `${formatSpan(removed)} · ${removed.title || "blok"}`,
      action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={block ? "Blok" : "Nový blok"}
      description={`${dayShort(day)} ${formatDate(day)} · ${formatMinutes(startMinutes)}-${formatMinutes(Math.min(DAY_MINUTES, startMinutes + duration))}`}
      footer={
        <>
          {block ? (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={remove}>
              <Trash2 /> Smazat
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button onClick={save} disabled={!block && title.trim().length === 0}>
            {block ? "Uložit" : "Vytvořit"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {linkedName ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <span className={cn("h-6 w-1 shrink-0 rounded-full", linkedTask ? "bg-progress" : "bg-foreground/60")} />
            <span className="min-w-0 flex-1 truncate">{linkedName}</span>
            {linkedTask ? (
              <Link
                href={`/tasks?id=${linkedTask.id}`}
                onClick={onClose}
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Otevřít <ExternalLink className="size-3" />
              </Link>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">ToDo</span>
            )}
          </div>
        ) : (
          <Field label="Co budeš dělat" htmlFor="block-title">
            <Input
              id="block-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Hluboká práce"
              maxLength={TIMEBLOCK_MAX_TITLE}
              autoComplete="off"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Den" htmlFor="block-day">
            <Input
              id="block-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value || day)}
            />
          </Field>
          <Field label="Začátek" htmlFor="block-start">
            <Input
              id="block-start"
              type="time"
              step={900}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Jak dlouho">
          <div className="flex flex-wrap gap-1.5">
            {DURATION_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setDuration(choice)}
                aria-pressed={duration === choice}
                className={cn(
                  "tabular rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  duration === choice
                    ? "border-foreground/40 bg-accent font-medium"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {formatLength(choice)}
              </button>
            ))}
          </div>
        </Field>

        {linkedTodo ? (
          <p className="text-xs text-muted-foreground">
            Čas bloku je zároveň termínem téhle položky v ToDo - posunutím se posune obojí.
          </p>
        ) : null}

        {!block && (picks.todos.length > 0 || picks.tasks.length > 0) ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Nebo si vezmi něco rozdělaného</p>
            <div className="flex flex-col gap-1">
              {picks.todos.map((todo) => (
                <PickRow
                  key={todo.id}
                  label={todo.text}
                  hint="ToDo"
                  tone="todo"
                  onClick={() => pick({ title: todo.text, todoId: todo.id })}
                />
              ))}
              {picks.tasks.map((task) => (
                <PickRow
                  key={task.id}
                  label={task.name}
                  hint={taskOrigin(state, task)}
                  icon={task.icon}
                  tone="task"
                  onClick={() => pick({ title: task.name, taskId: task.id })}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function PickRow({
  label,
  hint,
  icon,
  tone,
  onClick,
}: {
  label: string;
  hint: string;
  icon?: string;
  tone: "todo" | "task";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60 active:bg-accent"
    >
      <span
        className={cn("h-5 w-1 shrink-0 rounded-full", tone === "task" ? "bg-progress" : "bg-foreground/60")}
      />
      {icon ? <EntityIcon icon={icon} size="sm" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="max-w-[7rem] shrink-0 truncate text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

/** Minuty na "09:30" pro `<input type="time">`, který vedoucí nulu vyžaduje. */
function padTime(minutes: number): string {
  const total = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
