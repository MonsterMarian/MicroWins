"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  GripHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import { Field, Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, dayShort, formatDate } from "@/lib/date";
import { tapFeedback } from "@/lib/native";
import { projectById, taskById } from "@/lib/projects";
import {
  blockEnd,
  blocksOfDay,
  blockTitle,
  clampStart,
  DAY_MINUTES,
  DEFAULT_DURATION,
  DURATION_CHOICES,
  formatLength,
  formatMinutes,
  formatSpan,
  layoutDay,
  MIN_DURATION,
  nextFreeSlot,
  parseMinutes,
  plannedMinutes,
  snapMinutes,
  TIMEBLOCK_MAX_TITLE,
  unplannedTasks,
  unplannedTodos,
} from "@/lib/timeblocks";
import { formatTodoDue, isTodoOverdue } from "@/lib/todos";
import type { ISODate, MicroWinsState, Task, TimeBlock, Todo } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * Plán dne - timeblocking.
 *
 * Otázka, na kterou tahle obrazovka odpovídá, je jediná: **kdy na to bude
 * čas?** Proto tu nejsou procenta ani cíle - ty patří úkolům - a proto je
 * všechno postavené kolem jednoho gesta: vezmi něco rozdělaného a hoď to do
 * dne.
 *
 * Tři cesty dovnitř, každá na jedno ťuknutí:
 *
 * 1. **Pás nahoře** - otevřené položky ToDo a nedokončené úkoly. Ťuknutí je
 *    posadí do nejbližšího volného místa, žádný dialog. Kdyby se ptal na čas,
 *    přestala by to být cesta na jedno ťuknutí a člověk by radši nic
 *    neplánoval.
 * 2. **Ťuknutí do mřížky** - blok přesně tam, kam se ťuklo.
 * 3. **Tlačítko dole** - blok bez ohledu na to, kde je zrovna vidět.
 *
 * Puštěný blok se pak už jen tahá: podržet a posunout jinam, tahem za spodní
 * hranu prodloužit. Podržení (ne okamžitý tah) proto, že mřížka je plná bloků
 * a stránka se musí dát pořád normálně scrollovat - stejné pravidlo jako
 * u přetahování v seznamech.
 */

/** Kolik pixelů zabere minuta. Hodina = 84 px, čtvrthodina = 21 px. */
const PX_PER_MIN = 1.4;

/** Kdy začíná a končí mřížka, když do ní nic nezasahuje. */
const DEFAULT_FROM_HOUR = 6;
const DEFAULT_TO_HOUR = 23;

/** O kolik hodin povyroste mřížka po ťuknutí na "Dřív" / "Později". */
const EXTEND_HOURS = 3;

/** Jak dlouho se drží prst, než se blok zvedne. Sedí na přetahování v seznamech. */
const HOLD = 350;
/** Pohyb do téhle vzdálenosti je pořád ještě ťuknutí, ne tah. */
const SLOP = 10;

/** Tik pro čáru "teď" - jednou za minutu stačí, plán není stopky. */
function useNow(active: boolean): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function PlanPanel() {
  const { state, today, addBlock } = useStore();
  const { toast } = useToast();
  const [date, setDate] = React.useState<ISODate>(today);
  const [editing, setEditing] = React.useState<TimeBlock | null>(null);
  const [creating, setCreating] = React.useState<{ start: number } | null>(null);

  const isToday = date === today;
  const now = useNow(isToday);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const blocks = React.useMemo(() => blocksOfDay(state, date), [state, date]);
  const layout = React.useMemo(() => layoutDay(blocks), [blocks]);
  const planned = React.useMemo(() => plannedMinutes(blocks), [blocks]);

  /*
   * Mřížka drží pevné rozmezí, dokud do ní něco nezasahuje: den, který se
   * překresluje podle obsahu, by pod rukama pokaždé jinak skákal. Ranní nebo
   * noční blok ji roztáhne sám, zbytek si uživatel dovolá tlačítky.
   */
  const [extra, setExtra] = React.useState({ early: 0, late: 0 });
  React.useEffect(() => setExtra({ early: 0, late: 0 }), [date]);

  const fromHour = Math.max(
    0,
    Math.min(
      DEFAULT_FROM_HOUR - extra.early,
      ...blocks.map((b) => Math.floor(b.start / 60)),
    ),
  );
  const toHour = Math.min(
    24,
    Math.max(
      DEFAULT_TO_HOUR + extra.late,
      ...blocks.map((b) => Math.ceil(blockEnd(b) / 60)),
    ),
  );
  const fromMin = fromHour * 60;
  const height = (toHour - fromHour) * 60 * PX_PER_MIN;

  /** Odkud hledat volno: dnes od teď, jindy od rána. */
  const searchFrom = isToday ? Math.max(fromMin, nowMinutes) : Math.max(fromMin, 8 * 60);

  /*
   * Po otevření se plán sroluje na "teď" - jinak by člověk koukal na ráno,
   * které má za sebou. Jen když stránka stojí nahoře: vrátil-li se hub na
   * uloženou pozici, patří obrazovka jemu a přeskočit ji pod rukama by bylo
   * horší než ranní hodiny.
   */
  const gridRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isToday) return;
    const id = window.setTimeout(() => {
      const el = gridRef.current;
      if (!el || window.scrollY > 8) return;
      const top =
        el.getBoundingClientRect().top + window.scrollY + (nowMinutes - fromMin) * PX_PER_MIN - 150;
      // Skokem, ne plynule: obrazovka se má otevřít rovnou na dnešku, ne se
      // před očima teprve rozjíždět.
      window.scrollTo(0, Math.max(0, top));
    }, 90);
    return () => window.clearTimeout(id);
    // Schválně jen po otevření: každý další tik hodin by scrollem cukal.

  }, []);

  /**
   * Hození položky do plánu. Blok padne do nejbližšího volna, ne na "teď" -
   * dvě věci naráz v jednom čase jsou skoro vždycky omyl, a když se nevejde
   * nic, ať se aspoň nepřekrývá s tím, co už je naplánované.
   */
  const drop = (input: { title: string; todoId?: string; taskId?: string }) => {
    const start = nextFreeSlot(blocks, searchFrom, DEFAULT_DURATION);
    const block = addBlock({
      date,
      start,
      duration: DEFAULT_DURATION,
      title: input.title,
      todoId: input.todoId ?? null,
      taskId: input.taskId ?? null,
    });
    void tapFeedback();
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(start)}`,
      description: input.title,
      action: { label: "Upravit", onClick: () => setEditing(block) },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <DayHeader
        date={date}
        today={today}
        blocks={blocks.length}
        planned={planned}
        onChange={setDate}
      />

      <Queue date={date} onDrop={drop} />

      <Card className="overflow-hidden p-0">
        {fromHour > 0 ? (
          <EdgeButton
            label="Dřív"
            onClick={() => setExtra((e) => ({ ...e, early: e.early + EXTEND_HOURS }))}
          />
        ) : null}

        <Grid
          ref={gridRef}
          fromHour={fromHour}
          toHour={toHour}
          height={height}
          onPick={(start) => setCreating({ start })}
        >
          {layout.map(({ block, column, columns }) => (
            <BlockCard
              key={block.id}
              block={block}
              column={column}
              columns={columns}
              fromMin={fromMin}
              onOpen={() => setEditing(block)}
            />
          ))}

          {isToday && nowMinutes >= fromMin && nowMinutes <= toHour * 60 ? (
            <NowLine top={(nowMinutes - fromMin) * PX_PER_MIN} label={formatMinutes(nowMinutes)} />
          ) : null}

          {blocks.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center gap-1 px-6 text-center">
              <p className="text-sm font-medium">Den je zatím prázdný</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Ťukni do mřížky na hodinu, kterou chceš zabrat - nebo si vezmi něco z pásu nahoře.
              </p>
            </div>
          ) : null}
        </Grid>

        {toHour < 24 ? (
          <EdgeButton
            label="Později"
            onClick={() => setExtra((e) => ({ ...e, late: e.late + EXTEND_HOURS }))}
          />
        ) : null}
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Podrž prst na bloku a posuň ho jinam. Za spodní hranu se dá natáhnout.
      </p>

      <Fab
        onClick={() => setCreating({ start: nextFreeSlot(blocks, searchFrom, DEFAULT_DURATION) })}
        aria-label="Nový blok"
      >
        <Plus /> Nový blok
      </Fab>

      {creating ? (
        <BlockDialog
          date={date}
          start={creating.start}
          onClose={() => setCreating(null)}
        />
      ) : null}

      {editing ? (
        <BlockDialog block={editing} date={editing.date} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

// --- hlavička dne -----------------------------------------------------------

function DayHeader({
  date,
  today,
  blocks,
  planned,
  onChange,
}: {
  date: ISODate;
  today: ISODate;
  blocks: number;
  planned: number;
  onChange: (date: ISODate) => void;
}) {
  const isToday = date === today;
  const label = isToday
    ? "dnes"
    : date === addDays(today, 1)
      ? "zítra"
      : date === addDays(today, -1)
        ? "včera"
        : `${dayShort(date)} ${formatDate(date)}`;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Předchozí den"
        onClick={() => onChange(addDays(date, -1))}
      >
        <ChevronLeft />
      </Button>

      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-sm font-medium first-letter:uppercase">{label}</p>
        <p className="tabular text-xs text-muted-foreground">
          {blocks === 0
            ? "nic naplánovaného"
            : `${blocks} ${plural(blocks, "blok", "bloky", "bloků")} · ${formatLength(planned)}`}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Další den"
        onClick={() => onChange(addDays(date, 1))}
      >
        <ChevronRight />
      </Button>

      {/* Cesta zpátky na dnešek. Když už na něm stojíme, není co nabízet. */}
      {isToday ? null : (
        <Button variant="outline" size="sm" onClick={() => onChange(today)}>
          Dnes
        </Button>
      )}
    </div>
  );
}

// --- pás rozdělané práce ----------------------------------------------------

/**
 * Co ještě nemá svůj čas. Vodorovný pás schválně: seznam pod sebou by z plánu
 * udělal druhé ToDo, kdežto pás je zásobník, ze kterého se bere.
 */
function Queue({
  date,
  onDrop,
}: {
  date: ISODate;
  onDrop: (input: { title: string; todoId?: string; taskId?: string }) => void;
}) {
  const { state } = useStore();
  const todos = React.useMemo(() => unplannedTodos(state, date).slice(0, 12), [state, date]);
  const tasks = React.useMemo(() => unplannedTasks(state, date).slice(0, 12), [state, date]);

  if (todos.length === 0 && tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-xs text-muted-foreground">
        Ťukni a padne to do nejbližšího volna
      </p>
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

function TodoChip({ todo, onPick }: { todo: Todo; onPick: () => void }) {
  const overdue = isTodoOverdue(todo);
  const due = formatTodoDue(todo);

  return (
    <button
      type="button"
      onClick={onPick}
      className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent active:bg-accent"
    >
      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
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
    <button
      type="button"
      onClick={onPick}
      className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent active:bg-accent"
    >
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
function taskOrigin(state: MicroWinsState, task: Task): string {
  if (task.parentId) {
    const parent = taskById(state, task.parentId);
    if (parent) return parent.name;
  }
  return projectById(state, task.projectId)?.name ?? "";
}

// --- mřížka -----------------------------------------------------------------

function EdgeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border-b py-1.5 text-center text-xs text-muted-foreground transition-colors hover:bg-accent/50 last:border-b-0 last:border-t"
    >
      {label}
    </button>
  );
}

/** Levý sloupec s hodinami je široký přesně tolik, aby se do něj vešlo "23:00". */
const GUTTER = 44;

const Grid = React.forwardRef<
  HTMLDivElement,
  {
    fromHour: number;
    toHour: number;
    height: number;
    onPick: (start: number) => void;
    children: React.ReactNode;
  }
>(function Grid({ fromHour, toHour, height, onPick, children }, forwarded) {
  const ref = React.useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);

  React.useImperativeHandle(forwarded, () => ref.current as HTMLDivElement);

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Ťuknutí do bloku patří bloku, ne mřížce pod ním.
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const minutes = fromHour * 60 + (e.clientY - rect.top) / PX_PER_MIN;
    onPick(clampStart(snapMinutes(minutes), DEFAULT_DURATION));
  };

  return (
    <div ref={ref} className="relative" style={{ height }} onClick={pick}>
      {hours.map((hour, i) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-border/70"
          style={{ top: i * 60 * PX_PER_MIN, height: 60 * PX_PER_MIN }}
        >
          <span className="tabular absolute -top-2 left-0 w-10 pl-2 text-[11px] text-muted-foreground">
            {hour}:00
          </span>
          {/* Půlhodina jen naznačená - mřížka po čtvrthodinách by z plánu
              udělala tabulku. */}
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/40" />
        </div>
      ))}
      <div className="absolute inset-y-0" style={{ left: GUTTER, right: 4 }}>
        {children}
      </div>
    </div>
  );
});

function NowLine({ top, label }: { top: number; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="relative border-t border-win">
        <span className="tabular absolute -top-2 -left-11 rounded bg-win px-1 text-[10px] font-medium text-win-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

// --- blok -------------------------------------------------------------------

interface DragState {
  mode: "move" | "resize";
  start: number;
  duration: number;
}

/**
 * Jeden blok v mřížce.
 *
 * Tah se pozná až po podržení prstu - do té doby patří pohyb stránce, aby se
 * dal plán normálně scrollovat. Za spodní hranu se blok chytá rovnou: úchyt je
 * malý, na scrollování si ho nikdo neplete, a natahovat blok přes podržení by
 * bylo o krok navíc.
 */
function BlockCard({
  block,
  column,
  columns,
  fromMin,
  onOpen,
}: {
  block: TimeBlock;
  column: number;
  columns: number;
  fromMin: number;
  onOpen: () => void;
}) {
  const { state, moveBlock, resizeBlock, toggleBlockDone } = useStore();
  const [drag, setDrag] = React.useState<DragState | null>(null);
  /* Poslední stav tahu i mimo render - po puštění se z něj ukládá. Číst ho ze
     `setDrag` nejde: React může updater zavolat dvakrát a blok by se posunul
     dvakrát. */
  const dragRef = React.useRef<DragState | null>(null);
  const swallow = React.useRef(false);
  const session = React.useRef<{
    mode: "move" | "resize";
    pointerId: number;
    startY: number;
    base: number;
    hold: number;
    active: boolean;
    detach: () => void;
  } | null>(null);

  const title = blockTitle(state, block);
  const done = block.doneAt !== null;
  const start = drag?.start ?? block.start;
  const duration = drag?.duration ?? block.duration;
  const short = duration < 40;

  const begin = (mode: "move" | "resize", e: React.PointerEvent<HTMLElement>) => {
    if (session.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const element = e.currentTarget;
    const pointerId = e.pointerId;

    const onMove = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || s.pointerId !== ev.pointerId) return;
      if (!s.active) {
        // Než se blok zvedne, je pohyb prstu scrolování - a tím pádem konec.
        if (Math.abs(ev.clientY - s.startY) > SLOP) cancel(false);
        return;
      }
      if (ev.cancelable) ev.preventDefault();
      const delta = (ev.clientY - s.startY) / PX_PER_MIN;
      const next: DragState =
        s.mode === "move"
          ? {
              mode: "move",
              start: clampStart(snapMinutes(s.base + delta), block.duration),
              duration: block.duration,
            }
          : {
              mode: "resize",
              start: block.start,
              duration: Math.min(
                DAY_MINUTES - block.start,
                Math.max(MIN_DURATION, snapMinutes(s.base + delta)),
              ),
            };
      if (next.start !== dragRef.current?.start || next.duration !== dragRef.current?.duration) {
        void tapFeedback();
      }
      dragRef.current = next;
      setDrag(next);
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (session.current?.active && ev.cancelable) ev.preventDefault();
    };

    const onEnd = (ev: PointerEvent) => {
      const s = session.current;
      if (!s || s.pointerId !== ev.pointerId) return;
      cancel(true);
    };

    const cancel = (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      window.clearTimeout(s.hold);
      s.detach();
      if (s.active) {
        // Puštění po tahu nesmí otevřít editor - prst přece jen posouval.
        swallow.current = true;
        window.setTimeout(() => {
          swallow.current = false;
        }, 300);
      }

      const final = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!commit || !s.active || !final) return;
      if (final.mode === "move" && final.start !== block.start) moveBlock(block.id, final.start);
      if (final.mode === "resize" && final.duration !== block.duration) {
        resizeBlock(block.id, final.duration);
      }
    };

    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    session.current = {
      mode,
      pointerId,
      startY: e.clientY,
      base: mode === "move" ? block.start : block.duration,
      active: mode === "resize",
      hold:
        mode === "move"
          ? window.setTimeout(() => {
              const s = session.current;
              if (!s) return;
              s.active = true;
              void tapFeedback();
              dragRef.current = { mode: "move", start: block.start, duration: block.duration };
              setDrag(dragRef.current);
            }, HOLD)
          : 0,
      detach,
    };

    if (mode === "resize") {
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // starší WebView - tah funguje i bez zachycení
      }
      dragRef.current = { mode: "resize", start: block.start, duration: block.duration };
      setDrag(dragRef.current);
    }
  };

  React.useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      window.clearTimeout(s.hold);
      s.detach();
    },
    [],
  );

  const width = `calc(${100 / columns}% - ${columns > 1 ? 3 : 0}px)`;

  return (
    <div
      data-block
      onPointerDown={(e) => begin("move", e)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (swallow.current) return;
        onOpen();
      }}
      style={{
        top: (start - fromMin) * PX_PER_MIN,
        height: Math.max(18, duration * PX_PER_MIN - 2),
        left: `calc(${(column * 100) / columns}% + ${column > 0 ? 3 : 0}px)`,
        width,
      }}
      className={cn(
        "absolute z-10 overflow-hidden rounded-md border px-2 py-1 text-left transition-shadow",
        "select-none [-webkit-touch-callout:none]",
        done
          ? "border-progress/40 bg-progress-muted/50"
          : block.taskId
            ? "border-progress/50 bg-card"
            : "border-border bg-card",
        drag ? "z-30 shadow-lg ring-1 ring-foreground/20" : "shadow-sm",
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          aria-label={done ? `Vrátit zpět: ${title}` : `Hotovo: ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void tapFeedback();
            toggleBlockDone(block.id);
          }}
          className={cn(
            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
            done
              ? "border-progress bg-progress text-progress-foreground"
              : "border-muted-foreground/40",
          )}
        >
          {done ? <Check className="size-3" /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-xs font-medium leading-tight",
              done && "text-muted-foreground line-through",
            )}
          >
            {title}
          </p>
          {short ? null : (
            <p className="tabular text-[11px] leading-tight text-muted-foreground">
              {formatSpan({ ...block, start, duration })}
            </p>
          )}
        </div>

        {short ? (
          <span className="tabular shrink-0 text-[10px] text-muted-foreground">
            {formatMinutes(start)}
          </span>
        ) : null}
      </div>

      {/* Úchyt na spodní hraně. Reaguje hned, ale je malý - do scrolování se
          neplete a prstem se trefí. */}
      <span
        onPointerDown={(e) => {
          e.stopPropagation();
          begin("resize", e);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-hidden
        className="absolute inset-x-0 bottom-0 flex h-4 cursor-ns-resize touch-none items-end justify-center pb-0.5 text-muted-foreground/40"
      >
        <GripHorizontal className="size-3" />
      </span>
    </div>
  );
}

// --- editor -----------------------------------------------------------------

/**
 * Zakládání i úprava v jednom dialogu. Nový blok navíc nabídne, co je
 * rozdělané - ťuknutí na položku ho rovnou založí, takže nejčastější případ
 * je jedno ťuknutí a hotovo.
 */
function BlockDialog({
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
  const [time, setTime] = React.useState(() =>
    padTime(block ? block.start : (start ?? 9 * 60)),
  );
  const [duration, setDuration] = React.useState(block?.duration ?? DEFAULT_DURATION);
  const [day, setDay] = React.useState<ISODate>(block?.date ?? date);

  const linkedTask = block?.taskId ? state.tasks.find((t) => t.id === block.taskId) : undefined;
  const linkedTodo = block?.todoId ? state.todos.find((t) => t.id === block.todoId) : undefined;
  const linkedName = linkedTask?.name ?? linkedTodo?.text ?? "";

  const suggestions = React.useMemo(() => {
    if (block) return { todos: [], tasks: [] };
    return {
      todos: unplannedTodos(state, date).slice(0, 6),
      tasks: unplannedTasks(state, date).slice(0, 6),
    };
  }, [block, state, date]);

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
            <Clock3 className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{linkedName}</span>
            {linkedTask ? (
              <Link
                href={`/tasks?id=${linkedTask.id}`}
                onClick={onClose}
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Otevřít <ExternalLink className="size-3" />
              </Link>
            ) : null}
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
          <Field label="Začátek" htmlFor="block-start">
            <Input
              id="block-start"
              type="time"
              step={900}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Den" htmlFor="block-day">
            <Input
              id="block-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value || day)}
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

        {!block && (suggestions.todos.length > 0 || suggestions.tasks.length > 0) ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Nebo si vezmi něco rozdělaného
            </p>
            <div className="flex flex-col gap-1">
              {suggestions.todos.map((todo) => (
                <PickRow
                  key={todo.id}
                  label={todo.text}
                  hint="ToDo"
                  onClick={() => pick({ title: todo.text, todoId: todo.id })}
                />
              ))}
              {suggestions.tasks.map((task) => (
                <PickRow
                  key={task.id}
                  label={task.name}
                  hint={taskOrigin(state, task) || "úkol"}
                  icon={task.icon}
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
  onClick,
}: {
  label: string;
  hint: string;
  icon?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60 active:bg-accent"
    >
      {icon ? <EntityIcon icon={icon} size="sm" /> : <span className="size-2 rounded-full bg-muted-foreground/40" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

/** Minuty na "09:30" pro `<input type="time">`, který vedoucí nulu vyžaduje. */
function padTime(minutes: number): string {
  const total = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
