"use client";

import * as React from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerUpRight,
  GripVertical,
  Loader2,
  PenLine,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Fab } from "@/components/ui/fab";
import { isHoldDragging } from "@/components/ui/use-hold-drag";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, DAY_SHORT, formatDate, fromISODate, isValidISODate } from "@/lib/date";
import {
  AI_SETTINGS_EVENT,
  getAiKey,
  getAiModel,
  getAiProvider,
  suggestFromBrainDump,
  type Suggestion,
} from "@/lib/ai";
import { tapFeedback, tickFeedback, winFeedback } from "@/lib/native";
import {
  blocksOfDay,
  blockTitle,
  doneMinutes,
  formatLength,
  formatMinutes,
  nextFreeSlot,
  plannedMinutes,
} from "@/lib/timeblocks";
import {
  hasPriorityBlockAt,
  parseDumpTime,
  PRIORITY_COUNT,
  PRIORITY_MAX,
  priorityRef,
  SHEET_SLOT,
  sheetOf,
  unfinishedCarryovers,
  type CarryoverItem,
  type DumpSchedule,
} from "@/lib/timebox";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { AutoTextarea } from "./auto-textarea";
import { BlockSheet } from "./block-sheet";
import { CaptureSheet } from "./capture-sheet";
import { Queue } from "./queue";
import { ghostPosition, TimeboxGrid } from "./timebox-grid";
import {
  useTimeboxDrag,
  type DragSource,
  type DropTarget,
  type TimeboxDrag,
} from "./use-timebox-drag";
import { searchFrom, WhenSheet, type WhenPick, type WhenRequest } from "./when-sheet";

/**
 * Time box - papírový list dne přenesený do appky.
 *
 * Vždycky obsahuje všech pět sekcí: pás rozdělané práce, Nestihl jsem,
 * trojka hlavních věcí, mřížka časových bloků a brain dump.
 *
 * Tohle je rozvržení "Papír" - na tabletu čitelné, na telefonu se ale dva
 * sloupce mačkají na pár písmen a mřížka začíná až pod brain dumpem. Proto
 * jsou na výběr (Nastavení → Vzhled) i jednosloupcové verze: seznam
 * půlhodin a agenda jen s obsazenými půlhodinami. Data jsou ve všech stejná.
 */
export function TimeboxPanel() {
  const {
    state,
    today,
    addBlock,
    updateBlock,
    setPriority,
    swapPriorities,
    linkBlockToPriority,
    markPriorityCarried,
    deleteBlock,
    restoreBlock,
  } = useStore();
  const { timeboxStart, timeboxLayout, todoInTimebox } = usePrefs();
  const { toast } = useToast();
  const [date, setDate] = React.useState<ISODate>(() => today);

  /* Spodní panely listu. Naráz je otevřený nejvýš jeden - panel bloku
     předává „Jiný čas“ výběru času a sám se zavře. */
  const [when, setWhen] = React.useState<{
    request: WhenRequest;
    apply: (pick: WhenPick) => void;
  } | null>(null);
  const [openBlock, setOpenBlock] = React.useState<string | null>(null);
  const [capture, setCapture] = React.useState(false);
  const closeWhen = React.useCallback(() => setWhen(null), []);
  const closeBlock = React.useCallback(() => setOpenBlock(null), []);
  const closeCapture = React.useCallback(() => setCapture(false), []);

  /* Hlášky s akcí („Změnit“) se ťuknou až za chvíli - stav z renderu by byl
     ten před přidáním bloku, takže se čte čerstvý. */
  const latest = React.useRef(state);
  latest.current = state;

  /* Brain dump drží rozepsané řádky sám u sebe, ale tah ven z něj (do mřížky,
     do trojky, do koše) končí tady v panelu. BrainDump proto při každém
     renderu podá do tohohle ref své funkce na práci s řádky. */
  const dumpApi = React.useRef<DumpApi | null>(null);

  /** Výběr času pro existující blok - z hlášky „Změnit“ i z panelu bloku. */
  const reschedule = (block: TimeBlock, title: string) => {
    setOpenBlock(null);
    setWhen({
      request: { title, date: block.date, duration: block.duration, exclude: block.id },
      apply: (pick) => {
        const before = { date: block.date, start: block.start, duration: block.duration };
        updateBlock(block.id, pick);
        void tapFeedback();
        toast({
          tone: "info",
          title: `Přeplánováno na ${formatMinutes(pick.start)}`,
          description: pick.date !== date ? `${title} · ${formatDate(pick.date)}` : title,
          action: { label: "Vrátit", onClick: () => updateBlock(block.id, before) },
        });
      },
    });
  };

  /** Ťuknutí na úchyt plánuje do nejbližšího volna - a hláška nabídne jiný čas. */
  const changeTime = (id: string) => {
    const block = latest.current.timeBlocks.find((b) => b.id === id);
    if (block) reschedule(block, blockTitle(latest.current, block) || "Bez názvu");
  };

  const planned = (start: number, title: string, blockId?: string) =>
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(start)}`,
      description: title,
      ...(blockId ? { action: { label: "Změnit", onClick: () => changeTime(blockId) } } : {}),
    });

  /**
   * Věc na půlhodinu - puštěním do mřížky i z výběru času. `duration` přijde
   * jen z výběru času; tah drží délku přesouvaného bloku.
   */
  const placeOnSlot = (
    source: DragSource,
    target: { date: ISODate; start: number },
    duration?: number,
  ) => {
    const spot = { date: target.date, start: target.start };
    // Zápis z mřížky se přesouvá, všechno ostatní do mřížky přibývá.
    if (source.kind === "block") {
      updateBlock(source.id, { ...spot, ...(duration ? { duration } : {}) });
      return;
    }
    const length = duration ?? SHEET_SLOT;

    if (source.kind === "queue") {
      const block = addBlock({
        ...spot,
        duration: length,
        title: source.title,
        todoId: source.todoId ?? null,
        taskId: source.taskId ?? null,
      });
      planned(spot.start, source.title, block.id);
      return;
    }

    // Řádek brain dumpu: padne kam ho člověk pustil a z dumpu zmizí - věc
    // nesmí zůstat ležet dvakrát (jednou tady, jednou v mřížce).
    if (source.kind === "dump") {
      const block = addBlock({ ...spot, duration: length, title: source.title });
      dumpApi.current?.remove(source.rowId);
      planned(spot.start, source.title, block.id);
      return;
    }

    // Nestihnutá věc z dřívějšího dne: vznikne blok navázaný na původní
    // řádek (odškrtnutí platí na obě strany) a řádek se označí za
    // přenesený. Cílový den projde a blok zůstane neodškrtnutý? Zítra se
    // věc zase ozve v „Nestihl jsem“.
    if (source.kind === "carryover") {
      const block = addBlock({
        ...spot,
        duration: length,
        title: source.title,
        priorityId: priorityRef(source.date, source.index),
      });
      markPriorityCarried(source.date, source.index, spot.date);
      planned(spot.start, source.title, block.id);
      return;
    }

    /* Hlavní věc dne se **kopíruje i s odkazem**, nepřesouvá: v trojce má
       zůstat (je to pořád hlavní věc dne), v mřížce přibude čas, kdy se na ní
       bude dělat. Odškrtnutí pak platí na obou stranách. */
    const ref = priorityRef(source.date, source.index);
    if (hasPriorityBlockAt(state.timeBlocks, ref, spot.start, spot.date)) {
      toast({
        tone: "info",
        title: `Už tam je - ${formatMinutes(spot.start)}`,
        description: source.title,
      });
      return;
    }
    const block = addBlock({ ...spot, duration: length, title: source.title, priorityId: ref });
    planned(spot.start, source.title, block.id);
  };

  /** Výběr času pro věc, která se teprve plánuje (podržení, puštění na volno). */
  const askWhen = (source: DragSource, range?: WhenRequest["range"]) => {
    const block =
      source.kind === "block" ? state.timeBlocks.find((b) => b.id === source.id) : undefined;
    setWhen({
      request: {
        title: source.title,
        date: range?.date ?? block?.date ?? date,
        duration: block?.duration ?? SHEET_SLOT,
        exclude: block?.id ?? null,
        range: range ?? null,
      },
      apply: (pick) => {
        placeOnSlot(source, pick, pick.duration);
        void tapFeedback();
      },
    });
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

    // Řádek brain dumpu se do trojky napíše a z dumpu zmizí; věc z
    // dřívějšího dne se naopak na svém dni označí za přenesenou. Obojí se
    // drží u Vrátit, ať cesta zpátky vrátí celý přesun, ne jen text.
    const removed = source.kind === "dump" ? (dumpApi.current?.remove(source.rowId) ?? null) : null;
    if (source.kind === "carryover") markPriorityCarried(source.date, source.index, date);

    const previous = sheetOf(state, date).priorities[index]?.text ?? "";
    setPriority(date, index, source.title);
    // Zápis z mřížky zůstane navázaný, ať se odškrtává jen jednou.
    if (source.kind === "block") linkBlockToPriority(source.id, priorityRef(date, index));
    toast({
      tone: "info",
      title: `${index + 1}. hlavní věc dne`,
      description: source.title,
      // Obsazenou prioritu to přepíše - Vrátit vrátí text, řádek dumpu
      // i přenos z dřívějšího dne, ať nic nepropadne.
      ...(previous || removed || source.kind === "carryover"
        ? {
            action: {
              label: "Vrátit",
              onClick: () => {
                if (removed && dumpApi.current?.date === date)
                  dumpApi.current.restore(removed.row, removed.index);
                if (source.kind === "carryover")
                  markPriorityCarried(source.date, source.index, null);
                setPriority(date, index, previous);
              },
            },
          }
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
        title: "Odebráno",
        description: `${formatMinutes(removed.start)} ${source.title}`,
        action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
      });
      return;
    }
    if (source.kind === "dump") {
      const removed = dumpApi.current?.remove(source.rowId);
      if (!removed) return;
      toast({
        tone: "info",
        title: "Vyhozeno z brain dumpu",
        description: source.title,
        action: {
          label: "Vrátit",
          onClick: () => dumpApi.current?.restore(removed.row, removed.index),
        },
      });
      return;
    }
    if (source.kind === "carryover") {
      setPriority(source.date, source.index, "");
      toast({
        tone: "info",
        title: "Hlavní věc je pryč",
        description: `${source.title} · ${formatDate(source.date)}`,
        action: {
          label: "Vrátit",
          onClick: () => setPriority(source.date, source.index, source.title),
        },
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
   * pásem rozdělané práce, trojkou hlavních věcí, brain dumpem a mřížkou, a
   * to jsou části listu, které spolu jinak nemají co dělat.
   *
   * Podržení bez pohybu je volba místa bez tahu: zápis z mřížky otevře svůj
   * panel, všechno ostatní výběr času.
   */
  const drag = useTimeboxDrag(
    (source, target) => {
      if (target.kind === "slot") {
        placeOnSlot(source, target);
        return;
      }
      if (target.kind === "free") {
        askWhen(source, {
          date: target.date,
          from: target.start,
          to: target.start + target.count * SHEET_SLOT,
        });
        return;
      }
      if (target.kind === "priority") return dropOnPriority(source, target.index);
      return dropOnTrash(source);
    },
    (source) => {
      if (source.kind === "block") setOpenBlock(source.id);
      else askWhen(source);
    },
  );

  /* Koš nemá být vidět pořád - je to cesta, jak sundat zápis navázaný na úkol
     nebo na položku ToDo, kterému se text v políčku přepsat nedá. */
  const trashable =
    drag.ghost?.source.kind === "block" ||
    drag.ghost?.source.kind === "priority" ||
    drag.ghost?.source.kind === "dump" ||
    drag.ghost?.source.kind === "carryover";

  const queue = (
    /* Rozdělaná práce z ToDo a z projektů. Bez ní by se věc, která už někde
       leží, do listu musela přepsat rukou - a v appce by pak žila dvakrát. */
    <Queue
      date={date}
      showTodos={todoInTimebox}
      hint="Ťukni a padne do nejbližšího volna, podrž a vybereš čas, nebo ji táhni do mřížky"
      onDrop={(input) => {
        const start = nextFreeSlot(
          blocksOfDay(state, date),
          searchFrom(date, today, timeboxStart),
          SHEET_SLOT,
        );
        const block = addBlock({
          date,
          start,
          duration: SHEET_SLOT,
          title: input.title,
          todoId: input.todoId ?? null,
          taskId: input.taskId ?? null,
        });
        void tapFeedback();
        planned(start, input.title, block.id);
      }}
      onPress={(input, event) => drag.press({ kind: "queue", ...input }, event)}
    />
  );

  const carryover =
    /* Nestihl jsem: nedokončené hlavní věci z dřívějších dnů. Stálá sekce
       listu - když nic nevisí, jen to vypíše, ať má list pokaždé všech
       pět částí na stejném místě. */
    <Carryover date={date} today={today} drag={drag} />;

  const grid = (className?: string) => (
    <TimeboxGrid
      date={date}
      today={today}
      drag={drag}
      layout={timeboxLayout}
      onOpenBlock={setOpenBlock}
      className={className}
    />
  );

  const ghost = drag.ghost;
  const aimLabel = ghost ? targetLabel(ghost.source, drag.target, date) : null;

  return (
    <div className="flex flex-col gap-3">
      <DateBar date={date} today={today} onDate={setDate} />

      {/* Vždycky všech pět sekcí: pás, Nestihl jsem, trojka, mřížka, brain
          dump. Rozvržení mění jen to, jak se roztáhnou vedle sebe - schovávat
          části listu podle vzhledu znamenalo hledat věc na obrazovce, na
          které zrovna není. */}
      {timeboxLayout === "sheet" ? (
        <>
          {queue}
          {carryover}
          <div
            key={date}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:items-stretch"
          >
            {/* Levý sloupec se natáhne na výšku mřížky a brain dump v něm zabere
                všechno, co zbyde - psát se má kam, ne do řádkového pole. */}
            <div className="flex min-w-0 flex-col gap-3">
              <Priorities date={date} drag={drag} onChangeTime={changeTime} />
              <BrainDump
                date={date}
                size="fill"
                drag={drag}
                dumpApi={dumpApi}
                onChangeTime={changeTime}
              />
              <AiSuggestions date={date} today={today} onChangeTime={changeTime} />
            </div>
            {grid()}
          </div>
        </>
      ) : (
        <>
          {queue}
          {carryover}
          {/* Na telefonu jde mřížka hned pod trojku a brain dump až pod ni -
              den je to, co se tu čte nejčastěji. Levý sloupec se proto na úzké
              obrazovce rozpustí (`contents`) a jeho části se seřadí přes
              `order`; na širší zůstane sloupcem vedle mřížky. */}
          <div
            key={date}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-start"
          >
            <div className="contents sm:flex sm:min-w-0 sm:flex-col sm:gap-3">
              <Priorities
                date={date}
                drag={drag}
                onChangeTime={changeTime}
                className="order-1 sm:order-none"
              />
              <BrainDump
                date={date}
                size="fixed"
                drag={drag}
                dumpApi={dumpApi}
                onChangeTime={changeTime}
                className="order-3 sm:order-none"
              />
              <AiSuggestions
                date={date}
                today={today}
                onChangeTime={changeTime}
                className="order-4 sm:order-none"
              />
            </div>
            {grid("order-2 sm:order-none")}
          </div>
        </>
      )}

      {/* Koš je bublina v rohu, ne pruh přes celou spodní hranu: u spodní
          hrany se při tahu roluje, a kdo mířil dolů na pozdější hodinu, pustil
          věc do koše. Bublina sedí nad pásmem rolování. */}
      {trashable ? (
        <div
          data-trash=""
          aria-label="Pustit sem a zmizí to z listu"
          className={cn(
            "mw-fab-in fixed bottom-[calc(5.25rem+var(--mw-safe-bottom))] left-[calc(1rem+var(--mw-safe-left))] z-[45] flex size-16 flex-col items-center justify-center gap-0.5 rounded-full border text-[10px] font-medium shadow-lg transition-[transform,background-color,color] sm:bottom-6",
            drag.target?.kind === "trash"
              ? "scale-110 border-destructive bg-destructive text-destructive-foreground"
              : "bg-background/95 text-muted-foreground backdrop-blur",
          )}
        >
          <Trash2 className="size-5" />
          pryč
        </div>
      ) : null}

      {ghost ? (
        <div
          /* Duch visí nad prstem (ten by ho zakryl) a říká, kam věc padne -
             půlhodinu pod prstem není vidět, takže ji musí říct on. */
          className="pointer-events-none fixed z-50 flex max-w-[70vw] -translate-x-1/2 flex-col rounded-lg border-2 bg-popover px-3 py-1.5 shadow-xl"
          style={ghostPosition(ghost.x, ghost.y)}
        >
          <span className="truncate text-xs font-medium">
            {ghost.source.kind === "dump" ? ghost.source.label : ghost.source.title}
          </span>
          {aimLabel ? (
            <span
              className={cn(
                "tabular truncate text-sm font-semibold",
                drag.target?.kind === "trash" ? "text-destructive" : "text-foreground",
              )}
            >
              {aimLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {ghost ? null : (
        <Fab onClick={() => setCapture(true)} aria-label="Zapsat do brain dumpu">
          <PenLine /> Zapsat
        </Fab>
      )}

      <WhenSheet
        request={when?.request ?? null}
        onClose={closeWhen}
        onPick={(pick) => {
          const current = when;
          setWhen(null);
          current?.apply(pick);
        }}
      />
      <BlockSheet
        blockId={openBlock}
        onClose={closeBlock}
        onReschedule={(block) => reschedule(block, blockTitle(state, block) || "Bez názvu")}
      />
      <CaptureSheet open={capture} date={date} onClose={closeCapture} />
    </div>
  );
}

/** Kam věc padne, když se teď pustí - napsané v duchovi nad prstem. */
function targetLabel(source: DragSource, target: DropTarget | null, date: ISODate): string | null {
  if (!target) return null;
  switch (target.kind) {
    case "slot":
      return `→ ${formatMinutes(target.start)}${target.date !== date ? ` · ${formatDate(target.date)}` : ""}`;
    case "free":
      return `→ volno ${formatMinutes(target.start)}–${formatMinutes((target.start + target.count * SHEET_SLOT) % (24 * 60))}`;
    case "priority":
      if (source.kind !== "priority") return `→ ${target.index + 1}. hlavní věc`;
      // Nad vlastním řádkem se nic neprohodí - puštění tam tah jen zruší.
      return source.index === target.index ? null : `↔ prohodit s ${target.index + 1}.`;
    case "trash":
      return "→ pryč z listu";
  }
}

/** Švihnutí v hlavičce: jak daleko do strany a jak rychle, stejně jako mezi sekcemi. */
const DAY_SWIPE = 56;
const DAY_SWIPE_MS = 700;

/**
 * Hlavička dne. Švihnutím doleva a doprava se přepíná den (jen tady - na
 * zbytku listu švihnutí patří sekcím appky a řádkům mřížky), ťuknutím na
 * datum se otevře výběr data.
 */
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
  const picker = React.useRef<HTMLInputElement | null>(null);
  const swipe = React.useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const swallowClick = React.useRef(false);

  const go = (days: number) => {
    onDate(addDays(date, days));
    void tickFeedback();
  };

  const openPicker = () => {
    const input = picker.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      // starší WebView bez showPicker - aspoň fokus, ať naskočí systémový výběr
      input.focus();
      input.click();
    }
  };

  return (
    <div
      data-no-swipe=""
      className="flex touch-pan-y items-center gap-1"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: Date.now() };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s || s.id !== e.pointerId || isHoldDragging()) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Date.now() - s.at > DAY_SWIPE_MS) return;
        if (Math.abs(dx) < DAY_SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // Prst doleva = den odjíždí doleva = jsme o den dál.
        swallowClick.current = true;
        window.setTimeout(() => {
          swallowClick.current = false;
        }, 350);
        go(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={openPicker}
        aria-label={`Vybrat den, teď ${formatDate(date)}`}
        className="min-w-0 flex-1 rounded-md py-1 text-left"
      >
        <h2 key={date} className="animate-in-up truncate text-base font-semibold tracking-tight">
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
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={date}
        onChange={(e) => {
          if (isValidISODate(e.target.value)) onDate(e.target.value);
        }}
        className="pointer-events-none absolute size-px opacity-0"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        aria-label="Předchozí den"
        onClick={() => go(-1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        aria-label="Další den"
        onClick={() => go(1)}
      >
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
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
  onChangeTime,
  className,
}: {
  date: ISODate;
  drag: TimeboxDrag;
  onChangeTime: (blockId: string) => void;
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
            carriedTo={sheet.priorities[i]?.carriedTo ?? null}
            drag={drag}
            onChangeTime={onChangeTime}
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
  carriedTo,
  drag,
  onChangeTime,
  onCommit,
  onToggle,
}: {
  index: number;
  date: ISODate;
  value: string;
  done: boolean;
  carriedTo: ISODate | null;
  drag: TimeboxDrag;
  onChangeTime: (blockId: string) => void;
  onCommit: (text: string) => void;
  onToggle: () => void;
}) {
  const { state, today, addBlock } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  const [draft, setDraft, flush] = useDraft(value, onCommit);
  const empty = draft.trim() === "";
  /* Vlastní řádek cíl není - puštění na sebe by nic neprohodilo, takže se ani
     nesmí rozsvítit, jen zesvětlá jako každá tažená věc. */
  const source = drag.ghost?.source;
  const dragging = source?.kind === "priority" && source.index === index;
  const isTarget = !dragging && drag.target?.kind === "priority" && drag.target.index === index;

  /* Ťuknutí na úchyt: tažení věci přes půlku obrazovky je na telefonu
     nemotorné, ťuknutí ji posadí do nejbližšího volna mřížky. Už rozplánovaná
     věc se nerozdvojuje - kdo chce jiný čas, táhne. */
  const planNearest = () => {
    const ref = priorityRef(date, index);
    if (state.timeBlocks.some((b) => b.priorityId === ref)) {
      toast({ tone: "info", title: "Už je v mřížce", description: draft });
      return;
    }
    const start = nextFreeSlot(
      blocksOfDay(state, date),
      searchFrom(date, today, timeboxStart),
      SHEET_SLOT,
    );
    const block = addBlock({ date, start, duration: SHEET_SLOT, title: draft, priorityId: ref });
    void tapFeedback();
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(start)}`,
      description: draft,
      action: { label: "Změnit", onClick: () => onChangeTime(block.id) },
    });
  };

  return (
    <div
      data-priority-index={index}
      className={cn(
        "flex min-h-12 items-center gap-2 px-2.5 py-1.5 transition-colors",
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
        className="group/check -my-2 -ml-2.5 grid size-11 shrink-0 place-items-center"
      >
        {/* Klikací plocha na prst (44 px), vidět je jen čtvereček s číslem. */}
        <span
          className={cn(
            "tabular grid size-6 place-items-center rounded-[5px] border text-xs transition-colors",
            done
              ? "border-progress bg-progress text-progress-foreground"
              : "text-muted-foreground",
            !empty && !done && "group-hover/check:border-foreground/40",
          )}
        >
          {done ? <Check className="size-4" /> : index + 1}
        </span>
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

      {/* Věc přenesená ze staršího dne - na svém dni zůstala (historie se
          nepřepisuje), ale už se nenabízí v „Nestihl jsem“. */}
      {!done && carriedTo ? (
        <span
          title={`Přeneseno na ${formatDate(carriedTo)}`}
          aria-label={`Přeneseno na ${formatDate(carriedTo)}`}
          className="shrink-0 text-muted-foreground/60"
        >
          <CornerUpRight className="size-3.5" />
        </span>
      ) : null}

      {/* Úchyt na tažení do mřížky. Psát a táhnout jedním místem nejde -
          v textovém poli patří tah výběru textu. Ťuknutí (bez tažení) věc
          naplánuje do nejbližšího volna - cesta pro telefony. */}
      {empty ? null : (
        <button
          type="button"
          onPointerDown={(e) => drag.press({ kind: "priority", index, date, title: draft }, e)}
          onClick={planNearest}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`Přetáhnout: ${draft}`}
          title="Ťuknutí posadí do nejbližšího volna, podržení nechá vybrat čas, tah přenese do mřížky."
          className="-my-1.5 -mr-1.5 grid size-11 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/60 hover:text-foreground [-webkit-touch-callout:none]"
        >
          <GripVertical className="size-4" />
        </button>
      )}
    </div>
  );
}

// --- brain dump -------------------------------------------------------------

/**
 * Výška brain dumpu podle rozvržení: `fill` se na širší obrazovce natáhne na
 * výšku mřížky vedle, `fixed` má pod mřížkou pevnou plochu.
 */
const DUMP_SIZE = {
  fill: "min-h-48 flex-1",
  fixed: "min-h-40 sm:min-h-48",
} as const;

/** Jeden řádek brain dumpu. Id drží identitu řádku, i když jiné řádky
 *  přibývají a mizí - fokus i tažení se pak nemíchají mezi řádky. */
interface DumpRowData {
  id: number;
  text: string;
}

/** Funkce, kterými panel dostane k řádkům dumpu, když je někdo vytáhne
 *  tažením mimo dump - mřížka a trojka přece jen nevědí, co je v něm napsáno. */
type DumpApi = {
  /** Den, jehož dump API obsluhuje - Vrátit smí řádek vrátit jen do něj. */
  date: ISODate;
  remove: (rowId: number) => { row: DumpRowData; index: number } | null;
  restore: (row: DumpRowData, index: number) => void;
};

/** Text dumpu na řádky; prázdný dump má jeden prázdný řádek, ať se má kam psát. */
function parseDumpRows(text: string): DumpRowData[] {
  const lines = text === "" ? [] : text.split("\n");
  const rows: DumpRowData[] = lines.map((line, i) => ({ id: i, text: line }));
  if (rows.length === 0) rows.push({ id: 0, text: "" });
  return rows;
}

/** Řádky zpět na text; prázdné řádky na konci se zahodí, uprostřed zůstávají. */
function serializeDump(rows: DumpRowData[]): string {
  const lines = rows.map((r) => r.text);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

function BrainDump({
  date,
  size,
  className,
  drag,
  dumpApi,
  onChangeTime,
}: {
  date: ISODate;
  size: keyof typeof DUMP_SIZE;
  className?: string;
  drag: TimeboxDrag;
  dumpApi: React.RefObject<DumpApi | null>;
  onChangeTime: (blockId: string) => void;
}) {
  const { state, today, addBlock, setBrainDump } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  const value = sheetOf(state, date).brainDump;

  const [rows, setRows] = React.useState<DumpRowData[]>(() => parseDumpRows(value));
  const [focusId, setFocusId] = React.useState<number | null>(null);
  const ref = React.useRef({ rows, value });
  ref.current = { rows, value };

  /* Podržený úchyt patří řádku, který se táhne - ťuknutí na úchyt nejprve
     odbluruje pole (a spustí by commit), ale o osudu právě stisknutého řádku
     rozhodne puštění nebo ťuknutí, ne odchod z pole. Vydrží jen chvíli:
     podržení do startu tažení trvá ~420 ms a čistý tah žádný další commit
     nespouští, takže pozdější vypršení ničemu nevadí. */
  const pressingId = React.useRef<number | null>(null);
  const pressRow = (row: DumpRowData, event: React.PointerEvent<HTMLElement>) => {
    pressingId.current = row.id;
    window.setTimeout(() => {
      if (pressingId.current === row.id) pressingId.current = null;
    }, 700);
    const timed = parseDumpTime(row.text);
    drag.press(
      {
        kind: "dump",
        rowId: row.id,
        title: timed ? timed.title : row.text.trim(),
        label: row.text.trim(),
      },
      event,
    );
  };

  /* Externí změna (synchronizace, import) řádky přepíše. Vlastní uložení
     nastaví hodnotu shodnou s řádky, takže se tudy při psaní nic neděje. */
  React.useEffect(() => {
    if (value !== serializeDump(ref.current.rows)) setRows(parseDumpRows(value));
  }, [value]);

  /** Řádky do stavu. Volá se při odchodu z pole, při zániku komponenty i po
      každé akci, co řádky mění - rozmělněné ukládání po písmenu by přepisovalo
      celý stav při každém stisku klávesy. */
  const persist = (next: DumpRowData[]) => {
    // Poslední řádek odešel do mřížky či trojky - prázdný dump musí mít
    // aspoň jeden řádek, jinak by do něj nebylo kam psát.
    if (next.length === 0) next = [{ id: Math.max(0, ...ref.current.rows.map((r) => r.id)) + 1, text: "" }];
    setRows(next);
    const text = serializeDump(next);
    if (text !== ref.current.value) setBrainDump(date, text);
  };

  /** Uložení s tím, že řádky s časem dopředu se stanou bloky. Řádek z dumpu
      mizí, ať věc nezůstane ležet dvakrát - jednou tady, jednou v mřížce. */
  const commit = (snapshot: DumpRowData[]) => {
    const keep: DumpRowData[] = [];
    const scheduled: DumpSchedule[] = [];
    for (const row of snapshot) {
      const hit = parseDumpTime(row.text);
      // Právě stisknutý řádek se plánovat nesmí - čeká na puštění tažení.
      if (hit && row.id !== pressingId.current) scheduled.push(hit);
      else keep.push(row);
    }
    persist(keep);
    if (scheduled.length === 0) return;
    for (const item of scheduled) {
      addBlock({ date, start: item.start, duration: SHEET_SLOT, title: item.title });
    }
    toast({
      tone: "info",
      title:
        scheduled.length === 1
          ? `Naplánováno na ${formatMinutes(scheduled[0].start)}`
          : `Naplánováno: ${scheduled.length} ${plural(scheduled.length, "věc", "věci", "věcí")}`,
      description: scheduled.map((s) => `${formatMinutes(s.start)} ${s.title}`).join(" · "),
    });
  };

  /* Odchod ze záložky ani přepnutí dne text nezahodí - při zániku komponenty
     se dump uloží (a rozplánované řádky z něj vypadnou). */
  React.useEffect(
    () => () => {
      commit(ref.current.rows);
    },
    [],
  );

  const setText = (id: number, text: string) =>
    setRows(ref.current.rows.map((r) => (r.id === id ? { ...r, text } : r)));

  /** Enter na konci řádku přidá řádek nový, jinak jen skočí na další. */
  const enter = (index: number) => {
    const current = ref.current.rows;
    if (index < current.length - 1) {
      setFocusId(current[index + 1].id);
      return;
    }
    const id = Math.max(0, ...current.map((r) => r.id)) + 1;
    const next = [...current];
    next.splice(index + 1, 0, { id, text: "" });
    setRows(next);
    setFocusId(id);
  };

  /** Backspace na prázdném řádku ho smaže a skočí na konec předchozího. */
  const dropEmpty = (index: number) => {
    const current = ref.current.rows;
    if (index === 0 || current.length <= 1) return;
    const row = current[index];
    if (row.text !== "") return;
    persist(current.filter((r) => r.id !== row.id));
    setFocusId(current[index - 1].id);
  };

  /** Ťuknutí na úchyt: řádek s časem padne na svůj čas, jiný do nejbližšího
      volna. Na telefonu je to jediný spolehlivý způsob, jak věc z dumpu
      dostat do mřížky bez dlouhého tažení. */
  const planRow = (row: DumpRowData) => {
    const timed = parseDumpTime(row.text);
    const title = timed ? timed.title : row.text.trim();
    const start = timed
      ? timed.start
      : nextFreeSlot(blocksOfDay(state, date), searchFrom(date, today, timeboxStart), SHEET_SLOT);
    const block = addBlock({ date, start, duration: SHEET_SLOT, title });
    persist(ref.current.rows.filter((r) => r.id !== row.id));
    void tapFeedback();
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(start)}`,
      description: title,
      action: { label: "Změnit", onClick: () => onChangeTime(block.id) },
    });
  };

  /* Panel tady hledá cestu ven pro tažení - proto se API hlásí při každém
     renderu, jinak by pracovalo se zavřenýma očima. */
  dumpApi.current = {
    date,
    remove: (rowId) => {
      const current = ref.current.rows;
      const index = current.findIndex((r) => r.id === rowId);
      if (index === -1) return null;
      const row = current[index];
      persist(current.filter((r) => r.id !== rowId));
      return { row, index };
    },
    restore: (row, index) => {
      const next = [...ref.current.rows];
      next.splice(Math.min(index, next.length), 0, row);
      persist(next);
    },
  };

  return (
    /* Na telefonu má plocha svoji spodní mez, na širší obrazovce se natáhne
       na výšku mřížky - psát se má kam, ale mřížku to nesmí odsunout dolů. */
    <section className={cn("flex flex-col gap-1.5", DUMP_SIZE[size], className)}>
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Brain dump
      </h3>
      {/* Tečkovaná plocha jako na papírovém listu - psát se dá kamkoliv. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card shadow-sm"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      >
        <div className="divide-y">
          {rows.map((row, index) => (
            <DumpInput
              key={row.id}
              row={row}
              index={index}
              focus={focusId === row.id}
              drag={drag}
              onFocusHandled={() => setFocusId(null)}
              onText={(text) => setText(row.id, text)}
              onEnter={() => enter(index)}
              onDropEmpty={() => dropEmpty(index)}
              onCommit={() => commit(ref.current.rows)}
              onPlan={() => planRow(row)}
              onPress={(event) => pressRow(row, event)}
            />
          ))}
        </div>
      </div>
      <p className="px-0.5 text-xs text-muted-foreground">
        Čas dopředu („14:30 běh“) se odchodem z řádku sám posadí do mřížky. Úchyt: ťuknutí do
        nejbližšího volna, podržení vybere čas, tah do trojky, mřížky nebo do koše. Rychle zapsat
        jde i tlačítkem Zapsat dole.
      </p>
    </section>
  );
}

/** Editovatelný řádek brain dumpu s úchytem na tažení. */
function DumpInput({
  row,
  index,
  focus,
  drag,
  onFocusHandled,
  onText,
  onEnter,
  onDropEmpty,
  onCommit,
  onPlan,
  onPress,
}: {
  row: DumpRowData;
  index: number;
  focus: boolean;
  drag: TimeboxDrag;
  onFocusHandled: () => void;
  onText: (text: string) => void;
  onEnter: () => void;
  onDropEmpty: () => void;
  onCommit: () => void;
  onPlan: () => void;
  onPress: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const input = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    if (!focus) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocusHandled();
  }, [focus, onFocusHandled]);

  const empty = row.text.trim() === "";
  const dragging = drag.ghost?.source.kind === "dump" && drag.ghost.source.rowId === row.id;

  return (
    <div className={cn("flex min-h-11 items-center gap-2 px-2.5 py-1 transition-opacity", dragging && "opacity-40")}>
      <AutoTextarea
        ref={input}
        value={row.text}
        onChange={(e) => onText(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
            return;
          }
          /* Backspace na úplném začátku prázdného řádku ho zahodí - na
             telefonu jinak řádky luskat nejdou. */
          if (
            e.key === "Backspace" &&
            e.currentTarget.selectionStart === 0 &&
            e.currentTarget.selectionEnd === 0
          ) {
            onDropEmpty();
          }
        }}
        aria-label={`Brain dump, řádek ${index + 1}`}
        placeholder={index === 0 ? "Co se honí hlavou a nemá to čas ani pořadí" : ""}
        className="min-h-6 flex-1 py-0.5 text-sm leading-6"
      />
      {empty ? null : (
        <button
          type="button"
          onPointerDown={onPress}
          onClick={onPlan}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`Přetáhnout: ${row.text.trim()}`}
          title="Ťuknutí naplánuje do nejbližšího volna, podržení nechá vybrat čas, tah přenese do trojky či mřížky."
          className="-my-1.5 -mr-1.5 grid size-11 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/60 hover:text-foreground [-webkit-touch-callout:none]"
        >
          <GripVertical className="size-4" />
        </button>
      )}
    </div>
  );
}

// --- nestihl jsem -----------------------------------------------------------

/**
 * Klíč, podle kterého poznáme jednu a tu samou položku seznamu. Priorita
 * má `index` 0-2, blok z mřížky -1; stejný text ve stejný den na stejném
 * pořadí je táž věc i po smazání (a obnovení).
 */
function itemKey(item: CarryoverItem): string {
  return item.block ? `b:${item.block.id}` : `p:${item.date}#${item.index}`;
}

/**
 * Nedokončené věci z dřívějších dnů: hlavní věci i volné zápisy z mřížky.
 * Ťuknutí naplánuje věc do nejbližšího volna (zápis z mřížky se celý
 * přesune), tažení kamkoliv. Hlavní věc po přenosu na svém dni zůstane
 * (historie se nepřepisuje); přenesený blok je navázaný na původní řádek,
 * takže ho odškrtnutí uzavře, a projde-li den a zůstane ležet, ozve se znovu.
 */
function Carryover({ date, today, drag }: { date: ISODate; today: ISODate; drag: TimeboxDrag }) {
  const {
    state,
    addBlock,
    moveBlock,
    moveBlockToDay,
    markPriorityCarried,
    deleteBlock,
    restoreBlock,
    toggleBlockDone,
    togglePriority,
    setPriority,
    deleteCarryoverItem,
  } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  /* Smazání proběhne jednou atomickou akcí, ale UI může ještě chvíli držet
     starý render - držíme si proto klíče smazaných položek a rovnou je
     z výpisu vynecháváme. Po dalším přerenderu (až stav dojde) seznam
     prázdnou množinu zahodí sám. */
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const all = unfinishedCarryovers(state, today);
  const items = all
    .filter((item) => !hidden.has(itemKey(item)))
    .slice(0, 6);
  const hideNow = React.useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const showAgain = React.useCallback((key: string) => {
    setHidden((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const place = (item: CarryoverItem) => {
    const start = nextFreeSlot(
      blocksOfDay(state, date),
      searchFrom(date, today, timeboxStart),
      SHEET_SLOT,
    );
    // Zápis z mřížky se celý přesouvá na nový den - kopií by se jeden úkol
    // rozrostl na dva a ten starý by dál visel tady.
    const moved = item.block;
    if (moved) {
      const from = { date: moved.date, start: moved.start };
      moveBlockToDay(moved.id, date);
      moveBlock(moved.id, start);
      void tapFeedback();
      toast({
        tone: "info",
        title: `Přesunuto na ${formatMinutes(start)}`,
        description: item.text,
        action: {
          label: "Vrátit",
          onClick: () => {
            moveBlockToDay(moved.id, from.date);
            moveBlock(moved.id, from.start);
          },
        },
      });
      return;
    }
    const block = addBlock({
      date,
      start,
      duration: SHEET_SLOT,
      title: item.text,
      priorityId: priorityRef(item.date, item.index),
    });
    markPriorityCarried(item.date, item.index, date);
    void tapFeedback();
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(start)}`,
      description: item.text,
      action: {
        label: "Vrátit",
        onClick: () => {
          deleteBlock(block.id);
          markPriorityCarried(item.date, item.index, null);
        },
      },
    });
  };

  /**
   * Označení věci za hotovou (a cesta zpátky). U hlavní věci odškrtne
   * `togglePriority` i bloky, které z ní vznikly - odškrtnutí platí na obou
   * stranách. Nový blok se nezakládá: mřížka je plán do budoucna a hotová
   * věc do ní už nepatří; kdo ji chce v mřížce, plánuje úchytem.
   */
  const handleToggle = (e: React.MouseEvent, item: CarryoverItem) => {
    e.stopPropagation();
    const block = item.block;
    if (block) {
      toggleBlockDone(block.id);
      void winFeedback();
      toast({
        tone: "info",
        title: "Hotovo",
        description: `${item.text} · ${formatDate(block.date)} ${formatMinutes(block.start)}`,
        action: { label: "Vrátit", onClick: () => toggleBlockDone(block.id) },
      });
      return;
    }
    togglePriority(item.date, item.index);
    void winFeedback();
    toast({
      tone: "info",
      title: "Hotovo",
      description: `${item.text} · ${formatDate(item.date)}`,
      action: { label: "Vrátit", onClick: () => togglePriority(item.date, item.index) },
    });
  };

  const handleDelete = (e: React.MouseEvent, item: CarryoverItem) => {
    e.stopPropagation();
    const key = itemKey(item);
    const outcome = deleteCarryoverItem(item);
    if (!outcome) {
      toast({
        tone: "info",
        title: "Odebráno",
        description: item.text,
      });
      return;
    }
    /* Skryjeme řádek hned, i kdyby další render ještě chvíli trval. Když
       stav doběhne, filtr na množině ho vynechá i bez toho. */
    hideNow(key);
    if (outcome.kind === "block") {
      toast({
        tone: "info",
        title: "Odebráno",
        description: item.text,
        action: {
          label: "Vrátit",
          onClick: () => {
            showAgain(key);
            restoreBlock(outcome.item);
          },
        },
      });
      return;
    }
    // priority: obnovíme prioritu i případné bloky, co se s ní smazaly
    const removedBlocks = outcome.removedBlocks;
    toast({
      tone: "info",
      title: "Odebráno",
      description: item.text,
      action: {
        label: "Vrátit",
        onClick: () => {
          showAgain(key);
          setPriority(outcome.item.date, outcome.item.index, outcome.item.text);
          removedBlocks.forEach((b) => restoreBlock(b));
        },
      },
    });
  };

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Nestihl jsem
      </h3>
      {items.length === 0 ? (
        <p className="px-0.5 text-xs text-muted-foreground">
          Nic z dřívějších dnů nevisí - čisto.
        </p>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
        {items.map((item) => {
          const day = fromISODate(item.date);
          return (
            <div
              key={item.block?.id ?? `${item.date}#${item.index}`}
              className="flex min-h-12 items-center gap-2 px-2.5 py-1"
            >
              {/* Check-box - prázdný čtvereček, fajfka by se ukázala jen u hotových,
                  ale hotová věc okamžitě mizí ze seznamu, takže ji v praxi
                  není kde zobrazit. Zůstává proto prázdný. */}
              <button
                type="button"
                onClick={(e) => handleToggle(e, item)}
                aria-label="Označit jako hotové"
                title="Hotovo"
                className="group/check -my-1 -ml-2 grid size-11 shrink-0 place-items-center"
              >
                <span className="size-6 rounded border border-border transition-colors group-hover/check:border-foreground" />
              </button>
              <span className="tabular shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                {DAY_SHORT[day.getDay()]} {day.getDate()}. {day.getMonth() + 1}.
              </span>
              <p className="min-w-0 flex-1 py-0.5 text-sm leading-5">
                {item.block ? (
                  <span className="tabular mr-1 text-muted-foreground">
                    {formatMinutes(item.block.start)}
                  </span>
                ) : null}
                {item.text}
              </p>
              <button
                type="button"
                onClick={(e) => handleDelete(e, item)}
                aria-label={`Smazat: ${item.text}`}
                title="Smazat"
                className="-my-1 grid size-10 shrink-0 place-items-center rounded text-muted-foreground/50 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
              <button
                type="button"
                onPointerDown={(e) =>
                  drag.press(
                    item.block
                      ? { kind: "block", id: item.block.id, title: item.text }
                      : { kind: "carryover", date: item.date, index: item.index, title: item.text },
                    e,
                  )
                }
                onClick={() => place(item)}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={`Přenést: ${item.text}`}
                title="Ťukni a padne do nejbližšího volna, podrž a vybereš čas, nebo přetáhni do trojky a mřížky."
                className="-my-1 -mr-1.5 grid size-11 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/60 hover:text-foreground [-webkit-touch-callout:none]"
              >
                <GripVertical className="size-4" />
              </button>
            </div>
          );
        })}
        </Card>
      )}
      {all.length > items.length ? (
        <p className="px-0.5 text-xs text-muted-foreground">
          A další {all.length - items.length}{" "}
          {plural(all.length - items.length, "věc", "věci", "věcí")} - přenes nebo odškrtni i ty.
        </p>
      ) : null}
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
  onChangeTime,
  className,
}: {
  date: ISODate;
  today: ISODate;
  onChangeTime: (blockId: string) => void;
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
      const block = addBlock({ date, start, duration: SHEET_SLOT, title: item.text });
      toast({
        tone: "info",
        title: `Naplánováno na ${formatMinutes(start)}`,
        description: item.text,
        action: { label: "Změnit", onClick: () => onChangeTime(block.id) },
      });
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
