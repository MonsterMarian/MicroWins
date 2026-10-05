"use client";

import * as React from "react";
import { Clock, GripVertical, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { projectById, taskById } from "@/lib/projects";
import { allTodosToday, formatMinutes, unplannedTasks } from "@/lib/timeblocks";
import { formatTodoDue, isTodoOverdue } from "@/lib/todos";
import type { ISODate, MicroWinsState, Task, Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tapFeedback } from "@/lib/native";
import { CheckButton } from "./check-button";

/**
 * Rozdělaná práce nad listem dne - dvě sekce: ToDo a Úkoly.
 *
 * ToDo je seznam s řádky (jako Nestihl jsem), úkoly jsou pás chipů.
 * Otevřené položky ToDo se tady ukážou všechny: co už dnes v mřížce stojí,
 * jen ztlumené a s časem - sekce je jediné okno time boxu do ToDo a po
 * rozházení všeho by ztichla úplně, což vypadá jako chyba.
 */
export interface DropInput {
  title: string;
  todoId?: string;
  taskId?: string;
}

export function Queue({
  date,
  onDrop,
  onPress,
  hint = "Ťukni a padne to do nejbližšího volna",
  showTodos = true,
}: {
  date: ISODate;
  onDrop: (input: DropInput) => void;
  onPress?: (input: DropInput, event: React.PointerEvent<HTMLElement>) => void;
  hint?: string;
  showTodos?: boolean;
}) {
  const { state } = useStore();
  const todos = React.useMemo(
    () => (showTodos ? allTodosToday(state, date) : []),
    [state, date, showTodos],
  );
  /* Všechny, ne prvních deset: pás se posouvá do strany, a úkol za desítkou
     se dřív neukázal nikdy - vypadalo to, že po naplánování zmizel napořád. */
  const tasks = React.useMemo(() => unplannedTasks(state, date), [state, date]);

  const empty = todos.length === 0 && tasks.length === 0;

  if (empty && !showTodos) return null;

  return (
    <>
      <TaskQueue tasks={tasks} hint={hint} onDrop={onDrop} onPress={onPress} />
      <TodoQueue todos={todos} showTodos={showTodos} onDrop={onDrop} onPress={onPress} />
    </>
  );
}

type ChipPress = ((event: React.PointerEvent<HTMLElement>) => void) | undefined;

/**
 * ToDo sekce - seznam řádků podobný jako Nestihl jsem.
 */
function TodoQueue({
  todos,
  showTodos,
  onDrop,
  onPress,
}: {
  todos: { todo: Todo; plannedStart: number | null }[];
  showTodos: boolean;
  onDrop: (input: DropInput) => void;
  onPress?: (input: DropInput, event: React.PointerEvent<HTMLElement>) => void;
}) {
  if (!showTodos) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        ToDo
      </h3>
      {todos.length === 0 ? (
        <p className="px-0.5 text-xs text-muted-foreground">Nic otevřeného - čisto.</p>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          {todos.map(({ todo, plannedStart }) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              plannedStart={plannedStart}
              onDrop={onDrop}
              onPress={onPress}
            />
          ))}
        </Card>
      )}
    </section>
  );
}

function TodoRow({
  todo,
  plannedStart,
  onDrop,
  onPress,
}: {
  todo: Todo;
  plannedStart: number | null;
  onDrop: (input: DropInput) => void;
  onPress?: (input: DropInput, event: React.PointerEvent<HTMLElement>) => void;
}) {
  const { toggleTodo, deleteTodo, restoreTodo } = useStore();
  const { toast } = useToast();
  const overdue = isTodoOverdue(todo);
  const due = formatTodoDue(todo);
  const planned = plannedStart !== null;
  const done = todo.doneAt !== null;
  const input: DropInput = { title: todo.text, todoId: todo.id };

  /* Odškrtnutí je tu stejné jako v seznamu ToDo i v mřížce: přepne položku
     a s ní bloky, které z ní vznikly. Nic nového nezakládá ani nemaže - kdo
     chce věc zapsat do dne, táhne ji do mřížky. */

  /* Koš maže položku, ne její historii: zápis v mřížce zůstane se svým
     textem, stejně jako po smazání v seznamu ToDo. */
  const handleDelete = () => {
    const deleted = deleteTodo(todo.id);
    if (!deleted) return;
    void tapFeedback();
    toast({
      tone: "info",
      title: "Smazáno",
      description: deleted.text,
      action: { label: "Vrátit", onClick: () => restoreTodo(deleted) },
    });
  };

  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5">
      <span className="grid size-7 shrink-0 place-items-center">
        <CheckButton done={done} label={todo.text} onToggle={() => toggleTodo(todo.id)} />
      </span>
      <p
        className={cn(
          "min-w-0 flex-1 py-1 text-sm leading-5",
          done && "text-muted-foreground line-through",
          !done && planned && "text-muted-foreground",
        )}
      >
        {todo.text}
        {due ? (
          <span
            className={cn(
              "tabular ml-2 text-xs",
              overdue && !done ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {due}
          </span>
        ) : null}
      </p>
      {/* Čas, kdy položka dnes stojí v mřížce. Hodiny, ne fajfka - fajfka
          vedle zaškrtávátka by se četla jako „hotovo". */}
      {planned && !done ? (
        <span
          title={`Dnes v mřížce od ${formatMinutes(plannedStart)}`}
          className="tabular mt-1.5 flex shrink-0 items-center gap-0.5 text-xs text-progress"
        >
          <Clock className="size-3" />
          {formatMinutes(plannedStart)}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleDelete}
        aria-label={`Smazat: ${todo.text}`}
        title="Smazat položku"
        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded text-muted-foreground/50 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>
      {/* Úchyt jen u toho, co ještě dnes v mřížce nestojí: ťuknutí posadí do
          nejbližšího volna, podržení táhne. Rozplánovaná položka se znovu
          nenabízí, hotová už nemá kam. */}
      {!done && !planned ? (
        <button
          type="button"
          onClick={() => onDrop(input)}
          onPointerDown={onPress ? (e) => onPress(input, e) : undefined}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`Naplánovat: ${todo.text}`}
          title="Ťukni a padne do nejbližšího volna, nebo přetáhni do mřížky."
          className="mt-0.5 grid size-7 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/50 hover:text-foreground [-webkit-touch-callout:none]"
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Úkoly z projektů - pás chipů (zůstává původní).
 */
function TaskQueue({
  tasks,
  hint,
  onDrop,
  onPress,
}: {
  tasks: Task[];
  hint: string;
  onDrop: (input: DropInput) => void;
  onPress?: (input: DropInput, event: React.PointerEvent<HTMLElement>) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Úkoly
      </h3>
      <p className="px-1 text-xs text-muted-foreground">{hint}</p>
      <div className="scroll-quiet -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {tasks.map((task) => {
          const input: DropInput = { title: task.name, taskId: task.id };
          return (
            <TaskChip
              key={task.id}
              task={task}
              onPick={() => onDrop(input)}
              onPress={onPress ? (e) => onPress(input, e) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

const CHIP =
  "flex shrink-0 items-center gap-2 rounded-full border bg-card py-1.5 pl-1.5 pr-3 text-xs transition-colors hover:bg-accent active:bg-accent";

function pressProps(onPress: ChipPress) {
  if (!onPress) return {};
  return {
    onPointerDown: onPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    className: cn(CHIP, "cursor-grab [-webkit-touch-callout:none]"),
  };
}

function TaskChip({
  task,
  onPick,
  onPress,
}: {
  task: Task;
  onPick: () => void;
  onPress?: ChipPress;
}) {
  const { state } = useStore();
  const where = taskOrigin(state, task);

  return (
    <button type="button" onClick={onPick} className={CHIP} {...pressProps(onPress)}>
      <span className="h-4 w-1 shrink-0 rounded-full bg-progress" />
      <EntityIcon icon={task.icon} size="sm" />
      <span className="max-w-[11rem] truncate">{task.name}</span>
      {where ? (
        <span className="max-w-[7rem] shrink-0 truncate text-muted-foreground">{where}</span>
      ) : null}
    </button>
  );
}

/**
 * Odkud úkol je. U podúkolu se ukazuje **rodič**, ne projekt.
 */
export function taskOrigin(state: MicroWinsState, task: Task): string {
  if (task.parentId) {
    const parent = taskById(state, task.parentId);
    if (parent) return parent.name;
  }
  return projectById(state, task.projectId)?.name ?? "";
}
