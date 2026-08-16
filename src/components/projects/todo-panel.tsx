"use client";

import * as React from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback } from "@/lib/native";
import { countTodos, sortedTodos, todoRemaining, TODO_MAX_LENGTH } from "@/lib/todos";
import type { Todo } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * ToDo - jeden seznam a nic víc.
 *
 * Celá obrazovka umí čtyři věci: napsat, odškrtnout, přepsat, smazat. Žádný
 * dialog, žádné datum, žádná procenta - kdo potřebuje cíl a postup, má na to
 * projekty vedle. Tady je hodnota v tom, že se položka založí jedním psaním
 * a Enterem.
 *
 * Odškrtnutá položka klesne pod otevřené a šest hodin jí pod textem ubývá
 * vlasový pruh. Je to schválně jediný signál a bez čísla: kdo chce vědět,
 * jak dlouho tam ještě bude, se nedozví nic, protože to není potřeba vědět -
 * pruh říká jen "tohle za chvíli zmizí samo".
 */
export function TodoPanel() {
  const { state, addTodo } = useStore();
  const [text, setText] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const rows = React.useMemo(() => sortedTodos(state.todos), [state.todos]);
  const counts = React.useMemo(() => countTodos(state.todos), [state.todos]);
  const openIds = React.useMemo(
    () => rows.filter((t) => !t.doneAt).map((t) => t.id),
    [rows],
  );

  const submit = () => {
    if (!addTodo(text)) return;
    setText("");
    // Po přidání zůstává kurzor v poli - seznam se skoro vždycky píše najednou.
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Co je potřeba udělat"
          maxLength={TODO_MAX_LENGTH}
          autoComplete="off"
          aria-label="Nová položka"
        />
        <Button type="submit" disabled={text.trim().length === 0} className="shrink-0">
          <Plus /> Přidat
        </Button>
      </form>

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-medium">Seznam je prázdný</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Napiš, co je potřeba udělat, a přidej to Enterem. Odškrtnutá položka spadne dolů
            a po šesti hodinách zmizí sama.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TodoRows rows={rows} openIds={openIds} />
        </Card>
      )}

      {rows.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {counts.open > 0
            ? `Zbývá ${counts.open} ${plural(counts.open, "položka", "položky", "položek")}`
            : "Hotovo, nic nezbývá"}
          {counts.done > 0
            ? ` · ${counts.done} ${plural(counts.done, "hotová", "hotové", "hotových")} zmizí do šesti hodin`
            : openIds.length > 1
              ? " · podrž prst na položce a přetáhni ji"
              : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Otevřené položky jdou přetahovat, odškrtnuté ne - jejich pořadí drží čas
 * odškrtnutí a puštěný řádek by hned odskočil zpátky. Proto jsou to dva
 * seznamy pod sebou, ne jeden s vypnutou polovinou.
 */
function TodoRows({ rows, openIds }: { rows: Todo[]; openIds: string[] }) {
  const { reorderTodos } = useStore();
  const open = rows.filter((t) => !t.doneAt);
  const done = rows.filter((t) => t.doneAt);

  return (
    <>
      <SortableList
        ids={openIds}
        onReorder={reorderTodos}
        disabled={openIds.length < 2}
        className="divide-y"
      >
        {open.map((todo) => (
          <SortableItem key={todo.id} id={todo.id}>
            <TodoRow todo={todo} />
          </SortableItem>
        ))}
      </SortableList>

      {done.length > 0 ? (
        <div className={cn("divide-y", open.length > 0 && "border-t")}>
          {done.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const { toggleTodo, deleteTodo, restoreTodo, renameTodo } = useStore();
  const { toast } = useToast();
  const done = todo.doneAt !== null;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(todo.text);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== todo.text) renameTodo(todo.id, draft);
  };

  const onToggle = () => {
    void tapFeedback();
    toggleTodo(todo.id);
  };

  /*
   * Koš maže rovnou, ale nabídne cestu zpátky. Potvrzovací dialog by překážel
   * pokaždé, přitom se seznam na dnešek maže často a vedle trefit se stane
   * jednou za čas - obtěžovat má ten vzácnější případ, ne ten běžný.
   */
  const onDelete = () => {
    const removed = deleteTodo(todo.id);
    if (!removed) return;
    void tapFeedback();
    toast({
      tone: "info",
      title: "Smazáno",
      description: removed.text,
      action: { label: "Vrátit", onClick: () => restoreTodo(removed) },
    });
  };

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-accent/50">
      {/* Celý levý blok je zaškrtávátko a text v jednom tlačítku: na telefonu
          se míří prstem a políčko 16 px vedle textu je zbytečně malý terč. */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? `Vrátit zpět: ${todo.text}` : `Hotovo: ${todo.text}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 pl-1 pr-1 text-left"
      >
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-[5px] border transition-colors",
            done ? "border-progress bg-progress text-progress-foreground" : "border-muted-foreground/40",
          )}
        >
          {done ? <Check className="size-3.5" /> : null}
        </span>

        {editing ? null : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              done && "text-muted-foreground line-through",
            )}
            title={todo.text}
          >
            {todo.text}
          </span>
        )}
      </button>

      {editing ? (
        <Input
          autoFocus
          value={draft}
          maxLength={TODO_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(todo.text);
              setEditing(false);
            }
          }}
          aria-label="Text položky"
          className="h-8"
        />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Přepsat"
          title="Přepsat"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setDraft(todo.text);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Smazat"
        title="Smazat"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 />
      </Button>

      {done ? <ExpiryBar todo={todo} /> : null}
    </div>
  );
}

/**
 * Vlasový pruh na spodní hraně řádku. Šedý, 2 px, bez čísla - má jít přehlédnout.
 *
 * Přepočítává se po minutě, ne plynule: šest hodin je 360 minut, takže i tak
 * pruh viditelně ubývá, ale nic v seznamu se nehýbe pořád. Animace přechodu je
 * dlouhá schválně, aby minutový skok nebyl vidět jako cuknutí.
 */
function ExpiryBar({ todo }: { todo: Todo }) {
  const [ratio, setRatio] = React.useState(() => todoRemaining(todo));

  React.useEffect(() => {
    setRatio(todoRemaining(todo));
    const id = window.setInterval(() => setRatio(todoRemaining(todo)), 60_000);
    return () => window.clearInterval(id);
  }, [todo]);

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
    >
      <span
        className="block h-full bg-muted-foreground/25 transition-[width] duration-1000 ease-linear"
        style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
      />
    </span>
  );
}
