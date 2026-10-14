"use client";

import * as React from "react";
import { Check, GripVertical, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { formatMinutes, allTodosToday, blocksOfDay, nextFreeSlot } from "@/lib/timeblocks";
import { formatTodoDue, isTodoOverdue } from "@/lib/todos";
import { SHEET_SLOT } from "@/lib/timebox";
import type { ISODate, Todo, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tapFeedback } from "@/lib/native";

/**
 * Rozdělaná práce v listu dne - otevřené ToDo jako seznam řádků (jako
 * Nestihl jsem). Úkoly z projektů tu dřív byly taky, jako pás chipů nad ToDo;
 * na přání pryč, do listu dne nepatří.
 *
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
  showTodos = true,
}: {
  date: ISODate;
  onDrop: (input: DropInput) => void;
  onPress?: (input: DropInput, event: React.PointerEvent<HTMLElement>) => void;
  showTodos?: boolean;
}) {
  const { state } = useStore();
  const todos = React.useMemo(
    () => (showTodos ? allTodosToday(state, date) : []),
    [state, date, showTodos],
  );

  return (
    <TodoQueue
      todos={todos}
      showTodos={showTodos}
      date={date}
      onDrop={onDrop}
      onPress={onPress}
    />
  );
}

/**
 * ToDo sekce - seznam řádků podobný jako Nestihl jsem.
 */
function TodoQueue({
  todos,
  showTodos,
  date,
  onDrop,
  onPress,
}: {
  todos: { todo: Todo; plannedStart: number | null }[];
  showTodos: boolean;
  date: ISODate;
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
              date={date}
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
  date,
  onDrop,
  onPress,
}: {
  todo: Todo;
  plannedStart: number | null;
  date: ISODate;
  onDrop: (input: DropInput) => void;
  onPress?: (input: DropInput, event: React.PointerEvent<HTMLElement>) => void;
}) {
  const { state, today, toggleTodo, deleteTodo, restoreTodo, addBlock, deleteBlock } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  /* Fronta jinak nezávisí na čase - termíny „dnes 18:00" by zůstaly
     šedé i po tom, co termín propadne. Ticker po minutě vynutí přepočet
     `overdue`, aby červená naskočila a zase zmizela, když má. */
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const overdue = isTodoOverdue(todo);
  const due = formatTodoDue(todo);
  const planned = plannedStart !== null;
  const done = todo.doneAt !== null;
  const input: DropInput = { title: todo.text, todoId: todo.id };

  const handlePick = () => {
    if (planned) {
      toast({
        tone: "info",
        title: `Dnes v mřížce od ${formatMinutes(plannedStart)}`,
        description: todo.text,
      });
    } else {
      onDrop(input);
    }
  };

  /**
   * Označení jako hotové / vrácení zpět.
   * Pokud položka ještě není v mřížce, při označení jako hotové se tam automaticky
   * přidá do nejbližšího volna. Při vrácení zpět se blok z mřížky odstraní.
   */
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const wasHot = todo.doneAt !== null;

    toggleTodo(todo.id);
    void tapFeedback();

    if (!wasHot && !planned) {
      // Označuji jako hotové a není v mřížce → přidat blok
      const start = nextFreeSlot(
        blocksOfDay(state, date),
        date === today ? Math.max(timeboxStart * 60, new Date().getHours() * 60 + new Date().getMinutes()) : timeboxStart * 60,
        SHEET_SLOT,
      );
      const newBlock = addBlock({
        date,
        start,
        duration: SHEET_SLOT,
        title: todo.text,
        todoId: todo.id,
      });
      toast({
        tone: "info",
        title: `Hotovo · naplánováno na ${formatMinutes(start)}`,
        description: todo.text,
        action: {
          label: "Vrátit",
          onClick: () => {
            toggleTodo(todo.id);
            deleteBlock(newBlock.id);
          },
        },
      });
    } else if (wasHot) {
      // Vracím zpět → smazat všechny bloky pro tuto položku v dnešním dni
      const blocksToDelete = state.timeBlocks.filter((b) => b.todoId === todo.id && b.date === date);
      blocksToDelete.forEach((b) => deleteBlock(b.id));
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Pokud má položka blok v mřížce, smazat i ten
    const blocksToDelete = state.timeBlocks.filter((b) => b.todoId === todo.id && b.date === date);
    blocksToDelete.forEach((b) => deleteBlock(b.id));

    const deleted = deleteTodo(todo.id);
    if (!deleted) return;
    toast({
      tone: "info",
      title: "Odebráno",
      description: deleted.text,
      action: {
        label: "Vrátit",
        onClick: () => restoreTodo(deleted),
      },
    });
  };

  const pressProps = onPress && !planned
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => onPress(input, e),
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        className: "cursor-grab [-webkit-touch-callout:none]",
      }
    : {};

  return (
    <div className={cn("flex min-h-12 items-center gap-2 px-2.5 py-1", done && "opacity-60")}>
      {/* Check-box button - prázdný pro nedokončené, plná fajfka jen pro hotové. */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label={done ? "Označit jako nedokončené" : "Označit jako hotové"}
        title={done ? "Vrátit zpět" : "Hotovo"}
        className="group/check -my-1 -ml-2 grid size-11 shrink-0 place-items-center"
      >
        {/* Klikací plocha na prst (44 px), vidět je jen čtvereček. */}
        <span
          className={cn(
            "grid size-6 place-items-center rounded border transition-colors",
            done
              ? "border-progress bg-progress text-background"
              : "border-border text-muted-foreground group-hover/check:border-foreground",
          )}
        >
          {done ? <Check className="size-4" /> : null}
        </span>
      </button>
      <button
        type="button"
        onClick={handlePick}
        disabled={done}
        className={cn(
          "min-w-0 flex-1 text-left text-sm leading-5",
          done && "line-through text-muted-foreground",
          !done && planned && "text-muted-foreground",
          !done && !planned && "hover:text-foreground",
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
      </button>
      {planned && !done ? (
        <span className="tabular flex shrink-0 items-center gap-0.5 text-xs text-progress">
          <Check className="size-3" />
          {formatMinutes(plannedStart)}
        </span>
      ) : done ? (
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Smazat: ${todo.text}`}
          title="Smazat položku"
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded text-muted-foreground/50 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Smazat: ${todo.text}`}
            title="Smazat položku"
            className="-my-1 grid size-10 shrink-0 place-items-center rounded text-muted-foreground/50 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            type="button"
            {...pressProps}
            aria-label={`Přetáhnout: ${todo.text}`}
            title="Ťukni a padne do nejbližšího volna, podrž a vybereš čas, nebo přetáhni do mřížky."
            className="-my-1 -mr-1.5 grid size-11 shrink-0 place-items-center rounded text-muted-foreground/60 hover:text-foreground"
          >
            <GripVertical className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
