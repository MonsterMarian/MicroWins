"use client";

import * as React from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CornerUpRight,
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
import { tapFeedback } from "@/lib/native";
import {
  blocksOfDay,
  doneMinutes,
  formatLength,
  formatMinutes,
  nextFreeSlot,
  plannedMinutes,
} from "@/lib/timeblocks";
import {
  carryoverKey,
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
import { CheckButton } from "./check-button";
import { Queue } from "./queue";
import { TimeboxGrid } from "./timebox-grid";
import { useTimeboxDrag, type DragSource, type TimeboxDrag } from "./use-timebox-drag";

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
    moveBlock,
    moveBlockToDay,
    replacePriority,
    restorePriority,
    swapPriorities,
    linkBlockToPriority,
    togglePriority,
    toggleBlockDone,
    markCarried,
    deleteBlock,
    restoreBlock,
  } = useStore();
  const { timeboxStart, timeboxLayout, todoInTimebox } = usePrefs();
  const { toast } = useToast();
  const planned = usePlannedToast();
  const sheetActions = useSheetActions();
  const [date, setDate] = React.useState<ISODate>(() => today);

  /* Brain dump drží rozepsané řádky sám u sebe, ale tah ven z něj (do mřížky,
     do trojky, do koše) končí tady v panelu. BrainDump proto při každém
     renderu podá do tohohle ref své funkce na práci s řádky. */
  const dumpApi = React.useRef<DumpApi | null>(null);

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
      const block = addBlock({
        date: target.date,
        start: target.start,
        duration: SHEET_SLOT,
        title: source.title,
        todoId: source.todoId ?? null,
        taskId: source.taskId ?? null,
      });
      planned(block, source.title);
      return;
    }

    // Řádek brain dumpu: padne kam ho člověk pustil a z dumpu zmizí - věc
    // nesmí zůstat ležet dvakrát (jednou tady, jednou v mřížce).
    if (source.kind === "dump") {
      const block = addBlock({
        date: target.date,
        start: target.start,
        duration: SHEET_SLOT,
        title: source.title,
      });
      const removed = dumpApi.current?.remove(source.rowId) ?? null;
      planned(block, source.title, () => {
        if (removed) dumpApi.current?.restore(removed.row, removed.index);
      });
      return;
    }

    // Nestihnutá věc z dřívějšího dne se tu jen zaloguje; původní věc
    // zůstává na svém dni, jen se označí za přenesenou.
    if (source.kind === "carryover") {
      sheetActions.placeCarryover(source.item, target.date, target.start);
      return;
    }

    /* Hlavní věc dne se **kopíruje i s odkazem**, nepřesouvá: v trojce má
       zůstat (je to pořád hlavní věc dne), v mřížce přibude čas, kdy se na ní
       bude dělat. Odškrtnutí pak platí na obou stranách. */
    const ref = priorityRef(source.date, source.index);
    if (hasPriorityBlockAt(state.timeBlocks, ref, target.date, target.start)) {
      toast({
        tone: "info",
        title: `Už tam je - ${formatMinutes(target.start)}`,
        description: source.title,
      });
      return;
    }
    const block = addBlock({
      date: target.date,
      start: target.start,
      duration: SHEET_SLOT,
      title: source.title,
      priorityId: ref,
    });
    // Už odškrtnutá hlavní věc dostane odškrtnutý i nový zápis.
    if (sheetOf(state, source.date).priorities[source.index]?.done) toggleBlockDone(block.id);
    planned(block, source.title);
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

    const ref = priorityRef(date, index);
    const block =
      source.kind === "block" ? state.timeBlocks.find((b) => b.id === source.id) : undefined;
    // Zápis, který už je touhle hlavní věcí, nemá co měnit.
    if (block?.priorityId === ref) return;

    /* Na místo přijde jiná věc: stará se i s odškrtnutím a svými bloky
       odpojí (`replacePriority`), cesta zpátky ji vrátí celou. */
    const previous = sheetOf(state, date).priorities[index];
    const linked = state.timeBlocks.filter((b) => b.priorityId === ref).map((b) => b.id);
    const removedRow = source.kind === "dump" ? (dumpApi.current?.remove(source.rowId) ?? null) : null;
    if (source.kind === "carryover") markCarried(source.item, date);
    replacePriority(date, index, source.title);
    // Zápis z mřížky zůstane navázaný, ať se odškrtává jen jednou - a hotový
    // zápis udělá hotovou i hlavní věc.
    if (block) {
      linkBlockToPriority(block.id, ref);
      if (block.doneAt !== null) togglePriority(date, index);
    }
    void tapFeedback();
    toast({
      tone: "info",
      title: `${index + 1}. hlavní věc dne`,
      description: source.title,
      action: {
        label: "Vrátit",
        onClick: () => {
          restorePriority(date, index, previous, linked);
          if (block) linkBlockToPriority(block.id, block.priorityId);
          if (removedRow) dumpApi.current?.restore(removedRow.row, removedRow.index);
          if (source.kind === "carryover") markCarried(source.item, null);
        },
      },
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
      sheetActions.discardCarryover(source.item);
      return;
    }
    if (source.kind === "priority") {
      sheetActions.erasePriority(source.date, source.index, `${source.index + 1}. hlavní věc dne je pryč`);
    }
  };

  /**
   * Tažení po celém listu - proto bydlí tady, ne v mřížce: přetahuje se mezi
   * pásem rozdělané práce, trojkou hlavních věcí, brain dumpem a mřížkou, a
   * to jsou části listu, které spolu jinak nemají co dělat.
   */
  const drag = useTimeboxDrag((source, target) => {
    if (target.kind === "slot") return dropOnSlot(source, target);
    if (target.kind === "priority") return dropOnPriority(source, target.index);
    return dropOnTrash(source);
  });

  /* Koš nemá být vidět pořád - je to druhá cesta, jak věc z listu sundat
     (první je ťuknutí na ni a koš u ní). */
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
      hint="Ťukni a padne do nejbližšího volna, nebo si ji táhni do mřížky. Naplánovaný úkol se tu zítra nabídne znovu, dokud nemá 100 %."
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
        planned(block, input.title);
      }}
      onPress={(input, event) => drag.press({ kind: "queue", ...input }, event)}
    />
  );

  const carryover =
    /* Nestihl jsem: nedokončené věci z dřívějších dnů. Stálá sekce listu -
       když nic nevisí, jen to vypíše, ať má list pokaždé všech pět částí na
       stejném místě. */
    <Carryover date={date} today={today} drag={drag} />;

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
              <Priorities date={date} drag={drag} />
              <BrainDump date={date} size="fill" drag={drag} dumpApi={dumpApi} />
              <AiSuggestions date={date} today={today} />
            </div>
            <TimeboxGrid date={date} today={today} drag={drag} />
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
              <Priorities date={date} drag={drag} className="order-1 sm:order-none" />
              <BrainDump
                date={date}
                size="fixed"
                drag={drag}
                dumpApi={dumpApi}
                className="order-3 sm:order-none"
              />
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
          /* Větší duch než na desktopu: na telefonu ho prst zakrývá, takže
             aspoň vystoupí nad okolí a čte se, co se nese. */
          className="pointer-events-none fixed z-50 max-w-[70vw] truncate rounded-lg border-2 bg-popover px-3 py-2 text-xs font-medium shadow-xl"
          style={{ left: drag.ghost.x + 14, top: drag.ghost.y - 34 }}
        >
          {drag.ghost.source.kind === "dump" ? drag.ghost.source.label : drag.ghost.source.title}
        </div>
      ) : null}
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

/**
 * Hláška o posazení věci do mřížky - odkudkoliv (pás, trojka, dump, „Nestihl
 * jsem", návrhy) stejná a vždycky s cestou zpátky. `undo` vrátí věc tam,
 * odkud přišla (řádek do dumpu, přenos zpátky).
 */
function usePlannedToast() {
  const { deleteBlock } = useStore();
  const { toast } = useToast();
  return (block: TimeBlock, title: string, undo?: () => void) =>
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(block.start)}`,
      description: title,
      action: {
        label: "Vrátit",
        onClick: () => {
          deleteBlock(block.id);
          undo?.();
        },
      },
    });
}

/**
 * Co se dá udělat s hlavní věcí dne a s věcí z „Nestihl jsem". Volá se
 * z tlačítek u řádků i z puštění tažené věci - obě cesty musí dopadnout
 * stejně, jinak by koš u řádku dělal něco jiného než koš dole.
 */
function useSheetActions() {
  const {
    state,
    addBlock,
    deleteBlock,
    restoreBlock,
    markCarried,
    toggleCarryoverDone,
    replacePriority,
    restorePriority,
  } = useStore();
  const { toast } = useToast();
  const planned = usePlannedToast();

  /** Vygumuje hlavní věc i s odkazy jejích bloků; Vrátit ji vrátí celou. */
  const erasePriority = (date: ISODate, index: number, title: string) => {
    const previous = sheetOf(state, date).priorities[index];
    if (!previous || previous.text.trim() === "") return;
    const ref = priorityRef(date, index);
    const linked = state.timeBlocks.filter((b) => b.priorityId === ref).map((b) => b.id);
    replacePriority(date, index, "");
    toast({
      tone: "info",
      title,
      description: `${previous.text} · ${formatDate(date)}`,
      action: {
        label: "Vrátit",
        onClick: () => restorePriority(date, index, previous, linked),
      },
    });
  };

  /** Posadí nestihnutou věc do mřížky a na původním dni ji označí za přenesenou. */
  const placeCarryover = (item: CarryoverItem, date: ISODate, start: number) => {
    const block = addBlock({ date, start, duration: SHEET_SLOT, title: item.text });
    markCarried(item, date);
    planned(block, item.text, () => markCarried(item, null));
  };

  /** Dodělaná věc se odškrtne na svém dni - nic dalšího nevzniká. */
  const finishCarryover = (item: CarryoverItem) => {
    toggleCarryoverDone(item);
    toast({
      tone: "info",
      title: "Hotovo",
      description: `${item.text} · ${formatDate(item.date)}`,
      action: { label: "Vrátit", onClick: () => toggleCarryoverDone(item) },
    });
  };

  /** Věc, která už neplatí: hlavní věc se vygumuje, zápis z mřížky smaže. */
  const discardCarryover = (item: CarryoverItem) => {
    if (item.kind === "priority") {
      erasePriority(item.date, item.index, "Hlavní věc je pryč");
      return;
    }
    const removed = deleteBlock(item.id);
    if (!removed) return;
    toast({
      tone: "info",
      title: "Smazáno",
      description: `${item.text} · ${formatDate(item.date)}`,
      action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
    });
  };

  return { erasePriority, placeCarryover, finishCarryover, discardCarryover };
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
            carriedTo={sheet.priorities[i]?.carriedTo ?? null}
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
  carriedTo,
  drag,
  onCommit,
  onToggle,
}: {
  index: number;
  date: ISODate;
  value: string;
  done: boolean;
  carriedTo: ISODate | null;
  drag: TimeboxDrag;
  onCommit: (text: string) => void;
  onToggle: () => void;
}) {
  const { state, today, addBlock, toggleBlockDone } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  const planned = usePlannedToast();
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
    // Už odškrtnutá hlavní věc dostane odškrtnutý i nový zápis.
    if (done) toggleBlockDone(block.id);
    void tapFeedback();
    planned(block, draft);
  };

  return (
    <div
      data-priority-index={index}
      className={cn(
        "flex items-start gap-2 px-2.5 py-1.5 transition-colors",
        isTarget && "bg-progress/20 ring-1 ring-inset ring-progress",
        dragging && "opacity-40",
      )}
    >
      <CheckButton
        done={done}
        label={draft || `${index + 1}. hlavní věc`}
        onToggle={onToggle}
        disabled={empty}
        className="tabular mt-0.5 text-[11px]"
      >
        {index + 1}
      </CheckButton>
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
          className="mt-1 shrink-0 text-muted-foreground/60"
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
          title="Přetáhni do mřížky - vznikne blok navázaný na tuhle věc. Samotné ťuknutí ji posadí do nejbližšího volna."
          className="mt-0.5 grid size-7 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/50 hover:text-foreground [-webkit-touch-callout:none]"
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
}: {
  date: ISODate;
  size: keyof typeof DUMP_SIZE;
  className?: string;
  drag: TimeboxDrag;
  dumpApi: React.RefObject<DumpApi | null>;
}) {
  const { state, today, addBlock, setBrainDump } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  const planned = usePlannedToast();
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
    // Vytažením posledního řádku nesmí dump přijít o pole, do kterého se píše.
    setRows(
      next.length > 0 ? next : [{ id: Math.max(0, ...ref.current.rows.map((r) => r.id)) + 1, text: "" }],
    );
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
    const index = ref.current.rows.findIndex((r) => r.id === row.id);
    persist(ref.current.rows.filter((r) => r.id !== row.id));
    void tapFeedback();
    planned(block, title, () => {
      const next = [...ref.current.rows];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, row);
      persist(next);
    });
  };

  /* Panel tady hledá cestu ven pro tažení - proto se API hlásí při každém
     renderu, jinak by pracovalo se zavřenýma očima. */
  dumpApi.current = {
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
        Čas dopředu („14:30 běh“) se odchodem z řádku sám posadí do mřížky; úchytem řádek přetáhni
        do trojky, mřížky nebo na koš.
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
    <div className={cn("flex items-start gap-2 px-2.5 py-1 transition-opacity", dragging && "opacity-40")}>
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
          title="Přetáhni do trojky či mřížky. Samotné ťuknutí naplánuje do nejbližšího volna."
          className="mt-0.5 grid size-7 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/50 hover:text-foreground [-webkit-touch-callout:none]"
        >
          <GripVertical className="size-4" />
        </button>
      )}
    </div>
  );
}

// --- nestihl jsem -----------------------------------------------------------

/**
 * Nedokončené věci z dřívějších dnů - hlavní věci i zápisy napsané do
 * mřížky. Řádek má tři cesty a každá dělá jen jednu věc:
 *
 * - zaškrtávátko věc odškrtne **na jejím dni** (dodělal jsem ji),
 * - koš ji zahodí (už neplatí),
 * - úchyt ji přenese: ťuknutí do nejbližšího volna, tah kamkoliv.
 *
 * Po přenosu věc na svém dni zůstane (historie se nepřepisuje), jen už dál
 * netáhne. Dřív odškrtnutí zároveň zakládalo blok v mřížce a vrácení mazalo
 * bloky, které tam dal člověk sám - odškrtnutí, které dělá tři věci, se
 * nedá předvídat.
 */
function Carryover({ date, today, drag }: { date: ISODate; today: ISODate; drag: TimeboxDrag }) {
  const { state } = useStore();
  const { timeboxStart } = usePrefs();
  const actions = useSheetActions();
  /* Prohlížený den v minulosti ukazuje, co viselo před ním; dnešek i budoucí
     dny všechno před dneškem - dnešek ještě neskončil, nestihnout se nedá. */
  const before = date < today ? date : today;
  const all = unfinishedCarryovers(state, before);
  const items = all.slice(0, 6);

  const placeNearest = (item: CarryoverItem) => {
    const start = nextFreeSlot(
      blocksOfDay(state, date),
      searchFrom(date, today, timeboxStart),
      SHEET_SLOT,
    );
    void tapFeedback();
    actions.placeCarryover(item, date, start);
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
            const dragging =
              drag.ghost?.source.kind === "carryover" &&
              carryoverKey(drag.ghost.source.item) === carryoverKey(item);
            return (
              <div
                key={carryoverKey(item)}
                className={cn(
                  "flex items-start gap-2 px-2.5 py-1.5 transition-opacity",
                  dragging && "opacity-40",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center">
                  <CheckButton
                    done={false}
                    label={item.text}
                    onToggle={() => actions.finishCarryover(item)}
                  />
                </span>
                <span className="tabular mt-1.5 shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                  {DAY_SHORT[day.getDay()]} {day.getDate()}. {day.getMonth() + 1}.
                  {item.kind === "block" ? ` ${formatMinutes(item.start)}` : ""}
                </span>
                <p className="min-w-0 flex-1 py-1 text-sm leading-5">{item.text}</p>
                <button
                  type="button"
                  onClick={() => actions.discardCarryover(item)}
                  aria-label={`Smazat: ${item.text}`}
                  title="Už neplatí - smazat"
                  className="mt-0.5 grid size-7 shrink-0 place-items-center rounded text-muted-foreground/50 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
                <button
                  type="button"
                  onPointerDown={(e) =>
                    drag.press({ kind: "carryover", item, title: item.text }, e)
                  }
                  onClick={() => placeNearest(item)}
                  onContextMenu={(e) => e.preventDefault()}
                  aria-label={`Přenést: ${item.text}`}
                  title="Ťukni a padne do nejbližšího volna, nebo přetáhni do trojky či mřížky."
                  className="mt-0.5 grid size-7 shrink-0 cursor-grab place-items-center rounded text-muted-foreground/50 hover:text-foreground [-webkit-touch-callout:none]"
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
          {plural(all.length - items.length, "věc", "věci", "věcí")} - přenes, odškrtni nebo smaž
          i ty.
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
  className,
}: {
  date: ISODate;
  today: ISODate;
  className?: string;
}) {
  const { state, setPriority, addBlock } = useStore();
  const { timeboxStart } = usePrefs();
  const { toast } = useToast();
  const planned = usePlannedToast();
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
      planned(addBlock({ date, start, duration: SHEET_SLOT, title: item.text }), item.text);
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
