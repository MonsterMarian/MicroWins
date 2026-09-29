"use client";

import * as React from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, DAY_SHORT, formatDate, fromISODate } from "@/lib/date";
import {
  AI_SETTINGS_EVENT,
  getAiKey,
  getAiModel,
  getAiProvider,
  suggestFromBrainDump,
  type Suggestion,
} from "@/lib/ai";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  blocksOfDay,
  doneMinutes,
  formatLength,
  formatMinutes,
  nextFreeSlot,
  plannedMinutes,
} from "@/lib/timeblocks";
import {
  hasPriorityBlockAt,
  PRIORITY_COUNT,
  PRIORITY_MAX,
  priorityRef,
  SHEET_SLOT,
  sheetOf,
} from "@/lib/timebox";
import type { ISODate } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { Queue } from "@/components/plan/queue";
import { AutoTextarea } from "./auto-textarea";
import { TimeboxGrid } from "./timebox-grid";
import { useTimeboxDrag, type DragSource, type TimeboxDrag } from "./use-timebox-drag";

/**
 * Time box - papírový list dne přenesený do appky.
 *
 * Vlevo tři hlavní věci, pod nimi brain dump přes celou zbylou výšku a úplně
 * dole místo pro návrhy, které z brain dumpu vytáhne AI. Vpravo mřížka
 * půlhodin nad bloky Plánu dne.
 *
 * Tohle je rozvržení "Papír" - na tabletu čitelné, na telefonu se ale dva
 * sloupce mačkají na pár písmen a mřížka začíná až pod brain dumpem. Proto
 * jsou na výběr (Nastavení → Vzhled) i jednosloupcové verze: seznam
 * půlhodin, agenda jen s obsazenými půlhodinami a záložky, kde má den
 * a brain dump každý svou obrazovku. Data jsou ve všech stejná.
 */
export function TimeboxPanel() {
  const {
    state,
    today,
    addBlock,
    moveBlock,
    moveBlockToDay,
    setPriority,
    swapPriorities,
    linkBlockToPriority,
    deleteBlock,
    restoreBlock,
  } = useStore();
  const { timeboxStart, timeboxLayout } = usePrefs();
  const { toast } = useToast();
  const [date, setDate] = React.useState<ISODate>(() => today);
  const [pane, setPane] = React.useState<Pane>("day");

  const planned = (start: number, title: string) =>
    toast({ tone: "info", title: `Naplánováno na ${formatMinutes(start)}`, description: title });

  /** Puštění do políčka mřížky. */
  const dropOnSlot = (source: DragSource, target: { date: ISODate; start: number }) => {
    // Zápis z mřížky se přesouvá, všechno ostatní do mřížky přibývá.
    if (source.kind === "block") {
      const block = state.timeBlocks.find((b) => b.id === source.id);
      if (!block) return;
      if (block.date !== target.date) moveBlockToDay(source.id, target.date);
      if (block.start !== target.start) moveBlock(source.id, target.start);
      return;
    }

    if (source.kind === "queue") {
      addBlock({
        date: target.date,
        start: target.start,
        duration: SHEET_SLOT,
        title: source.title,
        todoId: source.todoId ?? null,
        taskId: source.taskId ?? null,
      });
      planned(target.start, source.title);
      return;
    }

    /* Hlavní věc dne se **kopíruje i s odkazem**, nepřesouvá: v trojce má
       zůstat (je to pořád hlavní věc dne), v mřížce přibude čas, kdy se na ní
       bude dělat. Odškrtnutí pak platí na obou stranách. */
    const ref = priorityRef(source.date, source.index);
    if (hasPriorityBlockAt(state.timeBlocks, ref, target.start)) {
      toast({
        tone: "info",
        title: `Už tam je - ${formatMinutes(target.start)}`,
        description: source.title,
      });
      return;
    }
    addBlock({
      date: target.date,
      start: target.start,
      duration: SHEET_SLOT,
      title: source.title,
      priorityId: ref,
    });
    planned(target.start, source.title);
  };

  /** Puštění nahoru mezi tři hlavní věci dne. */
  const dropOnPriority = (source: DragSource, index: number) => {
    // Dvě hlavní věci přes sebe se prohodí - pořadí trojky je jejich pořadí.
    if (source.kind === "priority") {
      if (source.index === index) return;
      swapPriorities(source.date, source.index, index);
      void tapFeedback();
      return;
    }

    const previous = sheetOf(state, date).priorities[index]?.text ?? "";
    setPriority(date, index, source.title);
    // Zápis z mřížky zůstane navázaný, ať se odškrtává jen jednou.
    if (source.kind === "block") linkBlockToPriority(source.id, priorityRef(date, index));
    toast({
      tone: "info",
      title: `${index + 1}. hlavní věc dne`,
      description: source.title,
      // Obsazenou prioritu to přepíše - cesta zpátky je na jedno ťuknutí.
      ...(previous
        ? { action: { label: "Vrátit", onClick: () => setPriority(date, index, previous) } }
        : {}),
    });
  };

  /** Puštění do koše - z listu to sundá, ale dá se to vrátit. */
  const dropOnTrash = (source: DragSource) => {
    if (source.kind === "block") {
      const removed = deleteBlock(source.id);
      if (!removed) return;
      toast({
        tone: "info",
        title: "Smazáno",
        description: `${formatMinutes(removed.start)} ${source.title}`,
        action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
      });
      return;
    }
    if (source.kind !== "priority") return;
    setPriority(source.date, source.index, "");
    toast({
      tone: "info",
      title: `${source.index + 1}. hlavní věc dne je pryč`,
      description: source.title,
      action: {
        label: "Vrátit",
        onClick: () => setPriority(source.date, source.index, source.title),
      },
    });
  };

  /**
   * Tažení po celém listu - proto bydlí tady, ne v mřížce: přetahuje se mezi
   * pásem rozdělané práce, trojkou hlavních věcí a mřížkou, a to jsou tři různé
   * části listu.
   */
  const drag = useTimeboxDrag((source, target) => {
    if (target.kind === "slot") return dropOnSlot(source, target);
    if (target.kind === "priority") return dropOnPriority(source, target.index);
    return dropOnTrash(source);
  });

  /* Koš nemá být vidět pořád - je to cesta, jak sundat zápis navázaný na úkol
     nebo na položku ToDo, kterému se text v políčku přepsat nedá. */
  const trashable = drag.ghost?.source.kind === "block" || drag.ghost?.source.kind === "priority";

  const queue = (
    /* Rozdělaná práce z ToDo a z projektů. Bez ní by se věc, která už někde
       leží, do listu musela přepsat rukou - a v appce by pak žila dvakrát. */
    <Queue
      date={date}
      hint="Rozdělaná práce: ťukni a padne do nejbližšího volna, nebo si ji táhni do mřížky"
      onDrop={(input) => {
        const start = nextFreeSlot(
          blocksOfDay(state, date),
          searchFrom(date, today, timeboxStart),
          SHEET_SLOT,
        );
        addBlock({
          date,
          start,
          duration: SHEET_SLOT,
          title: input.title,
          todoId: input.todoId ?? null,
          taskId: input.taskId ?? null,
        });
        void tapFeedback();
        planned(start, input.title);
      }}
      onPress={(input, event) => drag.press({ kind: "queue", ...input }, event)}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <DateBar date={date} today={today} onDate={setDate} />

      {timeboxLayout === "tabs" ? (
        <>
          <PaneSwitch pane={pane} onPane={setPane} date={date} />
          {/* Klíč podle dne: rozepsané texty patří tomu dni, ne políčku na obrazovce. */}
          <div key={date} className="flex flex-col gap-3">
            {pane === "day" ? (
              <>
                {queue}
                <Priorities date={date} drag={drag} />
                <TimeboxGrid date={date} today={today} drag={drag} layout="list" />
              </>
            ) : (
              <>
                <BrainDump date={date} size="screen" />
                <AiSuggestions date={date} today={today} />
              </>
            )}
          </div>
        </>
      ) : timeboxLayout === "sheet" ? (
        <>
          {queue}
          <div
            key={date}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:items-stretch"
          >
            {/* Levý sloupec se natáhne na výšku mřížky a brain dump v něm zabere
                všechno, co zbyde - psát se má kam, ne do řádkového pole. */}
            <div className="flex min-w-0 flex-col gap-3">
              <Priorities date={date} drag={drag} />
              <BrainDump date={date} size="fill" />
              <AiSuggestions date={date} today={today} />
            </div>
            <TimeboxGrid date={date} today={today} drag={drag} />
          </div>
        </>
      ) : (
        <>
          {queue}
          {/* Na telefonu jde mřížka hned pod trojku a brain dump až pod ni -
              den je to, co se tu čte nejčastěji. Levý sloupec se proto na úzké
              obrazovce rozpustí (`contents`) a jeho části se seřadí přes
              `order`; na širší zůstane sloupcem vedle mřížky. */}
          <div
            key={date}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-start"
          >
            <div className="contents sm:flex sm:min-w-0 sm:flex-col sm:gap-3">
              <Priorities date={date} drag={drag} className="order-1 sm:order-none" />
              <BrainDump date={date} size="fixed" className="order-3 sm:order-none" />
              <AiSuggestions date={date} today={today} className="order-4 sm:order-none" />
            </div>
            <TimeboxGrid
              date={date}
              today={today}
              drag={drag}
              layout={timeboxLayout}
              className="order-2 sm:order-none"
            />
          </div>
        </>
      )}

      {trashable ? (
        <div
          data-trash=""
          className={cn(
            "mw-safe-bottom mw-safe-x fixed inset-x-0 bottom-0 z-[45] flex items-center justify-center gap-2 border-t py-3 text-xs transition-colors",
            drag.target?.kind === "trash"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "bg-background/95 text-muted-foreground backdrop-blur",
          )}
        >
          <Trash2 className="size-4" />
          Pustit sem a zmizí to z listu
        </div>
      ) : null}

      {drag.ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-[45vw] truncate rounded-md border bg-popover px-2 py-1 text-[11px] shadow-lg"
          style={{ left: drag.ghost.x + 12, top: drag.ghost.y - 10 }}
        >
          {drag.ghost.source.title}
        </div>
      ) : null}
    </div>
  );
}

type Pane = "day" | "head";

/**
 * Přepínač v rozvržení "Záložky". Brain dump je na své obrazovce celý, takže
 * tečka u jeho záložky říká, že v něm něco leží - jinak by se na něj
 * zapomínalo.
 */
function PaneSwitch({
  pane,
  onPane,
  date,
}: {
  pane: Pane;
  onPane: (pane: Pane) => void;
  date: ISODate;
}) {
  const { state } = useStore();
  const hasDump = sheetOf(state, date).brainDump.trim() !== "";
  const tabs: { id: Pane; label: string }[] = [
    { id: "day", label: "Den" },
    { id: "head", label: "Brain dump" },
  ];

  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={pane === tab.id}
          onClick={() => onPane(tab.id)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm transition-colors",
            pane === tab.id
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.id === "head" && hasDump ? (
            <span className="size-1.5 rounded-full bg-progress" aria-label="něco v něm je" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Odkud hledat volné místo v mřížce. Dnes od nynějška - do minulosti se
 * neplánuje - jiný den od začátku mřížky.
 */
function searchFrom(date: ISODate, today: ISODate, timeboxStart: number): number {
  if (date !== today) return timeboxStart * 60;
  const now = new Date();
  return Math.max(timeboxStart * 60, now.getHours() * 60 + now.getMinutes());
}

function DateBar({
  date,
  today,
  onDate,
}: {
  date: ISODate;
  today: ISODate;
  onDate: (date: ISODate) => void;
}) {
  const { state } = useStore();
  const blocks = blocksOfDay(state, date);
  const planned = plannedMinutes(blocks);
  const done = doneMinutes(blocks);

  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold tracking-tight">
          <span className="text-muted-foreground">{DAY_SHORT[fromISODate(date).getDay()]} </span>
          {formatDate(date)}
          {date === today ? <span className="ml-1.5 text-xs text-progress">dnes</span> : null}
        </h2>
        <p className="tabular truncate text-xs text-muted-foreground">
          {blocks.length === 0
            ? "Prázdný den, ťukni do mřížky"
            : `${blocks.length} ${plural(blocks.length, "blok", "bloky", "bloků")} · ${formatLength(planned)}${
                done > 0 ? ` · hotovo ${formatLength(done)}` : ""
              }`}
        </p>
      </div>
      <Button variant="ghost" size="icon" aria-label="Předchozí den" onClick={() => onDate(addDays(date, -1))}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Další den" onClick={() => onDate(addDays(date, 1))}>
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dnes"
        title="Dnes"
        disabled={date === today}
        onClick={() => onDate(today)}
      >
        <CalendarDays />
      </Button>
    </div>
  );
}

// --- tři priority -----------------------------------------------------------

function Priorities({
  date,
  drag,
  className,
}: {
  date: ISODate;
  drag: TimeboxDrag;
  className?: string;
}) {
  const { state, setPriority, togglePriority } = useStore();
  const sheet = sheetOf(state, date);

  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tři hlavní věci
      </h3>
      <Card className="divide-y overflow-hidden p-0">
        {Array.from({ length: PRIORITY_COUNT }, (_, i) => (
          <PriorityRow
            key={i}
            index={i}
            date={date}
            value={sheet.priorities[i]?.text ?? ""}
            done={sheet.priorities[i]?.done ?? false}
            drag={drag}
            onCommit={(text) => setPriority(date, i, text)}
            onToggle={() => togglePriority(date, i)}
          />
        ))}
      </Card>
    </section>
  );
}

/**
 * Číslo priority je zároveň zaškrtávátko - dvě značky vedle sebe (pořadí
 * a odškrtnutí) by na řádku braly místo textu, a ten je tu to hlavní.
 */
function PriorityRow({
  index,
  date,
  value,
  done,
  drag,
  onCommit,
  onToggle,
}: {
  index: number;
  date: ISODate;
  value: string;
  done: boolean;
  drag: TimeboxDrag;
  onCommit: (text: string) => void;
  onToggle: () => void;
}) {
  const [draft, setDraft, flush] = useDraft(value, onCommit);
  const empty = draft.trim() === "";
  /* Vlastní řádek cíl není - puštění na sebe by nic neprohodilo, takže se ani
     nesmí rozsvítit, jen zesvětlá jako každá tažená věc. */
  const source = drag.ghost?.source;
  const dragging = source?.kind === "priority" && source.index === index;
  const isTarget = !dragging && drag.target?.kind === "priority" && drag.target.index === index;

  return (
    <div
      data-priority-index={index}
      className={cn(
        "flex items-start gap-2 px-2.5 py-1.5 transition-colors",
        isTarget && "bg-progress/20 ring-1 ring-inset ring-progress",
        dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={() => {
          void (done ? tapFeedback() : winFeedback());
          onToggle();
        }}
        disabled={empty}
        aria-pressed={done}
        aria-label={done ? `Vrátit zpět: ${draft}` : `Hotovo: ${draft || `${index + 1}. priorita`}`}
        className={cn(
          "tabular mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border text-[11px] transition-colors",
          done
            ? "border-progress bg-progress text-progress-foreground"
            : "text-muted-foreground",
          !empty && !done && "hover:border-foreground/40",
        )}
      >
        {done ? <Check className="size-3.5" /> : index + 1}
      </button>
      <AutoTextarea
        value={draft}
        maxLength={PRIORITY_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label={`${index + 1}. priorita dne`}
        placeholder={index === 0 ? "Co musí dnes padnout" : ""}
        className={cn(
          "flex-1 py-0.5 text-sm leading-5",
          done && "text-muted-foreground line-through",
        )}
      />

      {/* Úchyt na tažení do mřížky. Psát a táhnout jedním místem nejde -
          v textovém poli patří tah výběru textu. */}
      {empty ? null : (
        <button
          type="button"
          onPointerDown={(e) => drag.press({ kind: "priority", index, date, title: draft }, e)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`Přetáhnout: ${draft}`}
          title="Přetáhni do mřížky - vznikne blok navázaný na tuhle věc. Na jinou hlavní věc dne se prohodí."
          className="mt-1 shrink-0 cursor-grab text-muted-foreground/50 hover:text-foreground [-webkit-touch-callout:none]"
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// --- brain dump -------------------------------------------------------------

/**
 * Výška brain dumpu podle rozvržení: `fill` se na širší obrazovce natáhne na
 * výšku mřížky vedle, `fixed` má pod mřížkou pevnou plochu a `screen` bere
 * skoro celou obrazovku, protože ji v záložkách má jen pro sebe.
 */
const DUMP_SIZE = {
  fill: "min-h-48 flex-1",
  fixed: "min-h-40 sm:min-h-48",
  screen: "min-h-[60vh]",
} as const;

function BrainDump({
  date,
  size,
  className,
}: {
  date: ISODate;
  size: keyof typeof DUMP_SIZE;
  className?: string;
}) {
  const { state, setBrainDump } = useStore();
  const sheet = sheetOf(state, date);
  const [draft, setDraft, flush] = useDraft(sheet.brainDump, (text) => setBrainDump(date, text));

  return (
    /* Na telefonu má plocha svoji spodní mez, na širší obrazovce se natáhne
       na výšku mřížky - psát se má kam, ale mřížku to nesmí odsunout dolů. */
    <section className={cn("flex flex-col gap-1.5", DUMP_SIZE[size], className)}>
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Brain dump
      </h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        placeholder="Co se honí hlavou a nemá to čas ani pořadí"
        aria-label="Brain dump"
        className="flex-1 resize-none rounded-xl border bg-card p-3 text-sm leading-6 shadow-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
        /* Tečkovaná plocha jako na papírovém listu - psát se dá kamkoliv. */
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />
    </section>
  );
}

// --- návrhy z brain dumpu ---------------------------------------------------

/**
 * Co z poznámek vytáhne AI (Claude nebo Gemini). Návrh se jedním ťuknutím
 * propíše: cíl do volné priority, krok do nejbližší volné půlhodiny.
 *
 * Bez klíče se tu nic neděje - appka je jinak offline a nikam sama nevolá.
 */
function AiSuggestions({
  date,
  today,
  className,
}: {
  date: ISODate;
  today: ISODate;
  className?: string;
}) {
  const { state, setPriority, addBlock } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  const [hasKey, setHasKey] = React.useState(false);
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /* Klíč se zadává v nastavení, tedy v dialogu nad otevřeným listem - proto se
     poslouchá jeho změna. Bez toho by se tlačítko objevilo až po restartu. */
  React.useEffect(() => {
    const read = () => setHasKey(getAiKey() !== "");
    read();
    window.addEventListener(AI_SETTINGS_EVENT, read);
    return () => window.removeEventListener(AI_SETTINGS_EVENT, read);
  }, []);

  const sheet = sheetOf(state, date);
  const dump = sheet.brainDump.trim();

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = getAiProvider();
      const out = await suggestFromBrainDump({
        text: dump,
        key: getAiKey(provider),
        provider,
        model: getAiModel(provider),
      });
      setItems(out);
      if (out.length === 0) setError("Z poznámek se nedalo nic vytáhnout.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepovedlo se to.");
    } finally {
      setBusy(false);
    }
  };

  /** Cíl do první volné priority, krok do nejbližšího volna v mřížce. */
  const take = (item: Suggestion) => {
    if (item.kind === "priority") {
      const free = sheet.priorities.findIndex((p) => p.text.trim() === "");
      if (free === -1) {
        toast({ tone: "warn", title: "Priority jsou plné", description: "Uvolni jednu z trojky." });
        return;
      }
      setPriority(date, free, item.text);
    } else {
      const start = nextFreeSlot(
        blocksOfDay(state, date),
        searchFrom(date, today, timeboxStart),
        SHEET_SLOT,
      );
      addBlock({ date, start, duration: SHEET_SLOT, title: item.text });
      toast({ tone: "info", title: `Naplánováno na ${formatMinutes(start)}`, description: item.text });
    }
    void tapFeedback();
    setItems((prev) => prev.filter((i) => i !== item));
  };

  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2 px-0.5">
        <h3 className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Návrhy z brain dumpu
        </h3>
        {hasKey ? (
          <Button size="sm" variant="outline" disabled={busy || dump === ""} onClick={run}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? "Přemýšlí…" : "Navrhnout"}
          </Button>
        ) : null}
      </div>

      {!hasKey ? (
        <p className="px-0.5 text-xs text-muted-foreground">
          Návrhy umí Claude nebo Gemini - klíč přidáš v Nastavení → Addony. Bez něj appka nikam
          nevolá.
        </p>
      ) : items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <button
              key={`${item.kind}-${item.text}`}
              type="button"
              onClick={() => take(item)}
              title={item.kind === "priority" ? "Doplnit mezi priority" : "Posadit do nejbližšího volna"}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                item.kind === "priority" && "border-progress/50 text-progress-muted-foreground",
              )}
            >
              {item.kind === "priority" ? "★ " : "+ "}
              {item.text}
            </button>
          ))}
        </div>
      ) : (
        <p className="px-0.5 text-xs text-muted-foreground">
          {error ??
            (dump === ""
              ? "Napiš něco do brain dumpu a nech si z toho vytáhnout úkoly."
              : "Ťukni na Navrhnout a vyber si, co z toho platí.")}
        </p>
      )}
    </section>
  );
}

// --- drobnosti --------------------------------------------------------------

/**
 * Rozepsaný text drží komponenta a do stavu padne až při odchodu z pole.
 * Ukládat každé písmeno by znamenalo přepsat celý stav a sáhnout na
 * localStorage při každém stisku klávesy. Odchod ze záložky text nezahodí -
 * při zániku komponenty se dopíše.
 */
function useDraft(
  value: string,
  commit: (text: string) => void,
): [string, (text: string) => void, () => void] {
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef({ draft, value, commit });
  ref.current = { draft, value, commit };

  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(
    () => () => {
      const current = ref.current;
      if (current.draft !== current.value) current.commit(current.draft);
    },
    [],
  );

  const flush = React.useCallback(() => {
    const current = ref.current;
    if (current.draft !== current.value) current.commit(current.draft);
  }, []);

  return [draft, setDraft, flush];
}
