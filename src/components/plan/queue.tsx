"use client";

import * as React from "react";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { projectById, taskById } from "@/lib/projects";
import { unplannedTasks, unplannedTodos } from "@/lib/timeblocks";
import { formatTodoDue, isTodoOverdue } from "@/lib/todos";
import type { ISODate, MicroWinsState, Task, Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Pás rozdělané práce nad plánem.
 *
 * Vodorovný pás, ne seznam pod sebou: seznam by z plánu udělal druhé ToDo,
 * kdežto pás je zásobník, ze kterého se bere. Ťuknutí posadí věc do
 * nejbližšího volna - bez dialogu, bez ptaní na čas. Kdyby se pás ptal,
 * přestala by to být cesta na jedno ťuknutí a člověk by radši neplánoval nic.
 */
export interface DropInput {
  title: string;
  todoId?: string;
  taskId?: string;
}

export function Queue({
  date,
  onDrop,
}: {
  date: ISODate;
  onDrop: (input: DropInput) => void;
}) {
  const { state } = useStore();
  const todos = React.useMemo(() => unplannedTodos(state, date).slice(0, 10), [state, date]);
  const tasks = React.useMemo(() => unplannedTasks(state, date).slice(0, 10), [state, date]);

  if (todos.length === 0 && tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-xs text-muted-foreground">Ťukni a padne to do nejbližšího volna</p>
      <div className="scroll-quiet -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {todos.map((todo) => (
          <TodoChip key={todo.id} todo={todo} onPick={() => onDrop({ title: todo.text, todoId: todo.id })} />
        ))}
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} onPick={() => onDrop({ title: task.name, taskId: task.id })} />
        ))}
      </div>
    </div>
  );
}

const CHIP =
  "flex shrink-0 items-center gap-2 rounded-full border bg-card py-1.5 pl-1.5 pr-3 text-xs transition-colors hover:bg-accent active:bg-accent";

function TodoChip({ todo, onPick }: { todo: Todo; onPick: () => void }) {
  const overdue = isTodoOverdue(todo);
  const due = formatTodoDue(todo);

  return (
    <button type="button" onClick={onPick} className={CHIP}>
      <span className="h-4 w-1 shrink-0 rounded-full bg-foreground/60" />
      <span className="max-w-[11rem] truncate">{todo.text}</span>
      {due ? (
        <span className={cn("tabular shrink-0", overdue ? "text-destructive" : "text-muted-foreground")}>
          {due}
        </span>
      ) : null}
    </button>
  );
}

function TaskChip({ task, onPick }: { task: Task; onPick: () => void }) {
  const { state } = useStore();
  const where = taskOrigin(state, task);

  return (
    <button type="button" onClick={onPick} className={CHIP}>
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
 * Odkud úkol je. U podúkolu se ukazuje **rodič**, ne projekt: "Kniha 3" se
 * v projektu opakuje v každém čtvrtletí a dva stejné štítky vedle sebe se
 * nedají rozeznat, kdežto "Kniha 3 · 3. čtvrtletí" ano.
 */
export function taskOrigin(state: MicroWinsState, task: Task): string {
  if (task.parentId) {
    const parent = taskById(state, task.parentId);
    if (parent) return parent.name;
  }
  return projectById(state, task.projectId)?.name ?? "";
}
