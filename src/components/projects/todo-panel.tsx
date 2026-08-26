"use client";

import * as React from "react";
import { Check, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback } from "@/lib/native";
import { todoTtlMs } from "@/lib/prefs";
import { resolveDueRule } from "@/lib/due-rules";
import {
  countTodos,
  formatDue,
  formatDuration,
  formatRemaining,
  formatTodoDue,
  isTodoDueSoon,
  isTodoOverdue,
  sortedTodos,
  todoRemaining,
  todoRemainingMs,
  TODO_MAX_LENGTH,
} from "@/lib/todos";
import type { Todo } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * ToDo - jeden seznam a nic víc.
 *
 * Obrazovka umí pět věcí: napsat, odškrtnout, přepsat, smazat a - když je to
 * potřeba - přidat termín. Termín je schválně **až šestý krok**: v poli nahoře
 * není, protože seznam na dnešek se píše Enterem za Enterem a políčko s datem
 * by ten rytmus rozbilo. Kdo termín chce, ťukne na hodinky v řádku hotové
 * položky.
 *
 * Odškrtnutá položka klesne pod otevřené a pod textem jí ubývá vlasový pruh.
 * Vedle něj stojí tichá poznámka "zmizí za 5 h" - jedna věta bez odpočtu a bez
 * barvy. Doba i samotné mizení se dají přenastavit v Nastavení.
 */
export function TodoPanel() {
  const { state, addTodo } = useStore();
  const prefs = usePrefs();
  const ttlMs = todoTtlMs(prefs);
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
            Napiš, co je potřeba udělat, a přidej to Enterem.{" "}
            {ttlMs > 0
              ? `Odškrtnutá položka spadne dolů a po ${formatDuration(ttlMs)} zmizí sama.`
              : "Odškrtnutá položka spadne dolů a zůstane, dokud ji nesmažeš."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TodoRows rows={rows} openIds={openIds} ttlMs={ttlMs} />
        </Card>
      )}

      {rows.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          {counts.open > 0
            ? `Zbývá ${counts.open} ${plural(counts.open, "položka", "položky", "položek")}`
            : "Hotovo, nic nezbývá"}
          {counts.done > 0
            ? ttlMs > 0
              ? ` · ${counts.done} ${plural(counts.done, "hotová", "hotové", "hotových")} zmizí do ${formatDuration(ttlMs)}`
              : " · hotové nemizí samy"
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
function TodoRows({ rows, openIds, ttlMs }: { rows: Todo[]; openIds: string[]; ttlMs: number }) {
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
            <TodoRow todo={todo} ttlMs={ttlMs} />
          </SortableItem>
        ))}
      </SortableList>

      {done.length > 0 ? (
        <div className={cn("divide-y", open.length > 0 && "border-t")}>
          {done.map((todo) => (
            <TodoRow key={todo.id} todo={todo} ttlMs={ttlMs} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function TodoRow({ todo, ttlMs }: { todo: Todo; ttlMs: number }) {
  const { toggleTodo, deleteTodo, restoreTodo, renameTodo } = useStore();
  const { toast } = useToast();
  const done = todo.doneAt !== null;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(todo.text);
  const [dueOpen, setDueOpen] = React.useState(false);

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
    <div className="relative flex items-center gap-1.5 px-2 py-1.5 transition-colors hover:bg-accent/50">
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
      ) : null}

      {/* Termín má smysl jen u toho, co ještě čeká; u hotové položky sedí na
          jeho místě poznámka o mazání. */}
      {done ? <ExpiryNote todo={todo} ttlMs={ttlMs} /> : <DueButton todo={todo} onOpen={() => setDueOpen(true)} />}

      {editing ? null : (
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

      {done ? <ExpiryBar todo={todo} ttlMs={ttlMs} /> : null}

      <DueDialog todo={todo} open={dueOpen} onOpenChange={setDueOpen} />
    </div>
  );
}

/**
 * Hodinky v řádku. Bez termínu jsou to jen šedé hodinky, které jde přehlédnout;
 * s termínem se z nich stane štítek "dnes 14:00". Propadlý termín zčervená,
 * termín do hodiny ztmavne - a nic víc se neděje, žádné vykřičníky.
 */
function DueButton({ todo, onOpen }: { todo: Todo; onOpen: () => void }) {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    if (!todo.dueDate) return;
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [todo.dueDate]);

  if (!todo.dueDate) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Přidat termín"
        title="Přidat termín"
        className="shrink-0 text-muted-foreground/50 hover:text-foreground"
        onClick={onOpen}
      >
        <Clock3 />
      </Button>
    );
  }

  const overdue = isTodoOverdue(todo, now);
  const soon = isTodoDueSoon(todo, now);

  /* Nastavený termín ztratí hodinky: štítek s časem si ikonu vedle sebe
     nepotřebuje sáhnout a v úzkém řádku je každých šestnáct pixelů znát
     na textu položky. */
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Termín: ${formatTodoDue(todo, now)}`}
      className={cn(
        "tabular shrink-0 rounded-full px-2 py-1 text-[11px] transition-colors",
        "bg-muted/60 hover:bg-accent",
        overdue ? "text-destructive" : soon ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {formatTodoDue(todo, now)}
    </button>
  );
}

/**
 * Nastavení termínu.
 *
 * Nahoře je den a hodina, dole rychlá volba - a v tomhle pořadí schválně:
 * kdo otevře dialog, ví, co chce nastavit, a nabídky pod poli fungují jako
 * zkratka, ne jako první, přes co se musí přečíst. Na tlačítku je velké to,
 * co se dá vyslovit („Zítra ráno"), a hodina jen drobně pod tím - ta je
 * důsledek volby, ne volba sama.
 *
 * Co která nabídka znamená, se dá přenastavit a přidat další - viz
 * `lib/due-rules.ts` a Nastavení.
 */
function DueDialog({
  todo,
  open,
  onOpenChange,
}: {
  todo: Todo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setTodoDue } = useStore();
  const { dueRules } = usePrefs();
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setDate(todo.dueDate ?? "");
    setTime(todo.dueTime ?? "");
  }, [open, todo.dueDate, todo.dueTime]);

  /* Pravidla se přepočítají při otevření, ne při každém renderu: "za hodinu"
     se musí počítat od chvíle, kdy se člověk dívá, ale nesmí se pod rukama
     posouvat, dokud se rozmýšlí. */
  const now = React.useMemo(() => new Date(), [open]);

  const pick = (nextDate: string, nextTime: string | null) => {
    setTodoDue(todo.id, nextDate, nextTime);
    void tapFeedback();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Kdy to má být hotové"
      description={todo.text}
      footer={
        <>
          {todo.dueDate ? (
            <Button
              variant="ghost"
              className="mr-auto text-muted-foreground"
              onClick={() => {
                setTodoDue(todo.id, null);
                onOpenChange(false);
              }}
            >
              Bez termínu
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button disabled={!date} onClick={() => pick(date, time || null)}>
            Uložit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Den" htmlFor="todo-due-date">
            <Input
              id="todo-due-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Hodina (nepovinná)" htmlFor="todo-due-time">
            <Input
              id="todo-due-time"
              type="time"
              value={time}
              disabled={!date}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Rychle</p>
          <div className="grid grid-cols-2 gap-2">
            {dueRules.map((rule) => {
              const at = resolveDueRule(rule, now);
              return (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => pick(at.date, at.time)}
                  className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/60 active:bg-accent"
                >
                  <span className="truncate text-sm">{rule.label}</span>
                  <span className="tabular truncate text-[11px] text-muted-foreground/70">
                    {formatDue(at.date, at.time, now)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * "zmizí za 5 h" - tichá poznámka místo odpočtu. Přepočítává se po minutě
 * stejně jako pruh pod řádkem, ale hodiny se nedrobí na minuty: u pěti hodin
 * nikoho nezajímá, jestli je jich 5:12 nebo 5:47.
 */
function ExpiryNote({ todo, ttlMs }: { todo: Todo; ttlMs: number }) {
  const [left, setLeft] = React.useState(() => todoRemainingMs(todo, new Date(), ttlMs));

  React.useEffect(() => {
    setLeft(todoRemainingMs(todo, new Date(), ttlMs));
    const id = window.setInterval(() => setLeft(todoRemainingMs(todo, new Date(), ttlMs)), 60_000);
    return () => window.clearInterval(id);
  }, [todo, ttlMs]);

  if (left === null) return null;

  return (
    <span className="shrink-0 px-1 text-[11px] text-muted-foreground/70">
      zmizí {formatRemaining(left)}
    </span>
  );
}

/**
 * Vlasový pruh na spodní hraně řádku. Šedý, 2 px, bez čísla - má jít přehlédnout.
 *
 * Přepočítává se po minutě, ne plynule: i tak pruh viditelně ubývá, ale nic
 * v seznamu se nehýbe pořád. Animace přechodu je dlouhá schválně, aby minutový
 * skok nebyl vidět jako cuknutí.
 */
function ExpiryBar({ todo, ttlMs }: { todo: Todo; ttlMs: number }) {
  const [ratio, setRatio] = React.useState(() => todoRemaining(todo, new Date(), ttlMs));

  React.useEffect(() => {
    setRatio(todoRemaining(todo, new Date(), ttlMs));
    const id = window.setInterval(() => setRatio(todoRemaining(todo, new Date(), ttlMs)), 60_000);
    return () => window.clearInterval(id);
  }, [todo, ttlMs]);

  // Vypnuté mizení nemá co odměřovat - plný pruh by lhal.
  if (ttlMs <= 0) return null;

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

