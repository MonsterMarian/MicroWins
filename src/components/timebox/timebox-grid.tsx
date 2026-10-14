"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Link2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useHoldDrag } from "@/components/ui/use-hold-drag";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { addDays } from "@/lib/date";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  blockTitle,
  formatLength,
  formatMinutes,
  TIMEBLOCK_MAX_TITLE,
} from "@/lib/timeblocks";
import {
  resizedDuration,
  SHEET_SLOT,
  slotContent,
  timeboxRows,
  timeboxSlots,
  type SheetSlot,
} from "@/lib/timebox";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutoTextarea } from "./auto-textarea";
import { findSheetTarget, type SheetTarget, type TimeboxDrag } from "./use-timebox-drag";
import { SWIPE_THRESHOLD, useSwipeRow } from "./use-swipe-row";

/**
 * Mřížka time boxu: hodina na řádek, sloupce `:00` a `:30`.
 *
 * Políčko **nemá vlastní data** - je to časový blok (`lib/timeblocks.ts`).
 * Do jedné půlhodiny se jich vejde víc (překryvy appka povoluje odjakživa)
 * a přetáhnout se dají prstem jinam; dlouhý text políčko neusekne, jen mu
 * naroste řádek.
 *
 * Mřížka je rozbalená: každá půlhodina má svůj řádek přes celou šířku, i ta
 * prázdná, takže se dá kamkoli ťuknout i pustit věc bez rozbalování. Dřív se
 * prázdné půlhodiny slévaly do řádku „volno“ a rozbalovaly se až podržením
 * prstu - na přání pryč. Papírový list se sloupci `:00` a `:30` padl taky.
 *
 * Zápis: ťuknutí otevře panel bloku, švihnutí doprava odškrtne, doleva pošle
 * na zítra a pilulkou s délkou se blok protáhne tahem dolů.
 */

/** Které políčko se zrovna píše. `blockId: null` = nový blok. */
interface Editing {
  date: ISODate;
  start: number;
  blockId: string | null;
}

/** Tah za pilulku s délkou - co se protahuje. */
interface ResizeSource {
  id: string;
  title: string;
}

export function TimeboxGrid({
  date,
  today,
  drag,
  onOpenBlock,
  className,
}: {
  date: ISODate;
  today: ISODate;
  /** Tažení drží panel - přetahuje se i mezi trojkou hlavních věcí a mřížkou. */
  drag: TimeboxDrag;
  /** Ťuknutí na zápis - panel bloku drží panel listu, ať je jen jeden naráz. */
  onOpenBlock: (id: string) => void;
  className?: string;
}) {
  const { state, resizeBlock } = useStore();
  const { timeboxStart, timeboxEnd } = usePrefs();
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const now = useNowMinutes();
  const container = React.useRef<HTMLElement | null>(null);

  const rows = React.useMemo(
    () => timeboxRows(date, timeboxStart, timeboxEnd),
    [date, timeboxStart, timeboxEnd],
  );

  /** Všechna políčka po sobě - Enter posouvá na další, i přes konec hodiny. */
  const slots = React.useMemo(() => timeboxSlots(rows), [rows]);

  /* Mřížka může přetéct přes půlnoc, takže dnů bývá víc než jeden - bloky se
     proto berou pro každý den zvlášť a ne jednou pro `date`. */
  const blocksByDate = React.useMemo(() => {
    const map = new Map<ISODate, TimeBlock[]>();
    for (const row of rows) {
      if (!map.has(row.date)) {
        map.set(
          row.date,
          state.timeBlocks
            .filter((b) => b.date === row.date)
            .sort((a, b) => a.start - b.start || a.createdAt.localeCompare(b.createdAt)),
        );
      }
    }
    return map;
  }, [state.timeBlocks, rows]);

  /* Tah za pilulku s délkou. Úchyt nic jiného neumí, takže táhne hned, bez
     podržení; ťuknutí na něj (bez pohybu) otevře panel bloku s čipy délky. */
  const resize = useHoldDrag<ResizeSource, SheetTarget>({
    immediate: true,
    findTarget: (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? findSheetTarget(el) : null;
    },
    onDrop: (source, target) => {
      const block = state.timeBlocks.find((b) => b.id === source.id);
      if (!block) return;
      const duration = resizedDuration(block, target);
      if (duration === block.duration) return;
      resizeBlock(block.id, duration);
      void tapFeedback();
    },
    onHold: (source) => onOpenBlock(source.id),
  });

  const dragging = drag.ghost !== null || resize.ghost !== null;
  /** Kam až by blok po puštění pilulky sahal - políčka se v tom rozsahu rozsvítí. */
  const resizeRange = React.useMemo(() => {
    if (!resize.ghost || !resize.target) return null;
    const block = state.timeBlocks.find((b) => b.id === resize.ghost?.source.id);
    if (!block) return null;
    const target =
      resize.target.kind === "slot"
        ? resize.target
        : { date: resize.target.date, start: resize.target.start };
    return { block, end: block.start + resizedDuration(block, target) };
  }, [resize.ghost, resize.target, state.timeBlocks]);

  const inResize = (slot: SheetSlot) => {
    if (!resizeRange) return false;
    const { block, end } = resizeRange;
    const at = slot.start + (slot.date > block.date ? 24 * 60 : 0);
    return (slot.date === block.date || slot.date === addDays(block.date, 1)) && at >= block.start && at < end;
  };

  const isEditing = (slot: SheetSlot) =>
    editing !== null && editing.date === slot.date && editing.start === slot.start;

  const renderSlot = (index: number) => {
    const slot = slots[index];
    return (
      <Slot
        date={slot.date}
        start={slot.start}
        blocks={blocksByDate.get(slot.date) ?? []}
        editing={isEditing(slot) ? editing : null}
        onEdit={setEditing}
        onOpenBlock={onOpenBlock}
        next={slots[index + 1] ?? null}
        drag={drag}
        onResizePress={(source, e) => resize.press(source, e)}
        resizingId={resize.ghost?.source.id ?? null}
        highlighted={inResize(slot)}
        isNow={isNowSlot(slot, today, now)}
      />
    );
  };

  const isToday = slots.some((slot) => isNowSlot(slot, today, now));
  const pill = useNowPill(container, isToday && !dragging, [date, now, state.timeBlocks]);

  const nowPill =
    pill !== null ? (
      <button
        type="button"
        onClick={() =>
          container.current
            ?.querySelector("[data-timebox-now]")
            ?.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        className="mw-fab-in fixed bottom-[calc(5.25rem+var(--mw-safe-bottom))] left-1/2 z-30 flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-semibold text-background shadow-lg shadow-black/30 sm:bottom-6"
      >
        {pill === "down" ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
        Teď {formatMinutes(now)}
      </button>
    ) : null;

  const resizeGhost =
    resize.ghost && resizeRange ? (
      <div
        className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-lg border-2 border-progress bg-popover px-3 py-1.5 text-sm font-semibold shadow-xl"
        style={ghostPosition(resize.ghost.x, resize.ghost.y)}
      >
        do {formatMinutes(resizeRange.end % (24 * 60))} · {formatLength(resizeRange.end - resizeRange.block.start)}
      </div>
    ) : null;

  const hint = (
    <p className="px-1 text-xs text-muted-foreground">
      Ťukni do políčka a piš. Zápis: ťuknutí otevře čas, délku a akce, švihnutí doprava odškrtne,
      doleva pošle na zítra, podržením ho přetáhneš a za pilulku s délkou protáhneš dolů. Odškrtnutí
      platí všude, kde se ta věc ukáže.
    </p>
  );

  return (
    <section ref={container} className={cn("flex flex-col gap-1.5", className)}>
      <Card className="-mx-4 overflow-hidden rounded-none border-x-0 p-0 sm:mx-0 sm:rounded-xl sm:border-x">
        {slots.map((slot, index) => (
          <div
            key={`${slot.date}-${slot.start}`}
            className={cn(
              "grid grid-cols-[3.25rem_minmax(0,1fr)] border-b last:border-b-0",
              // Půlhodina uvnitř hodiny se odděluje jen jemně, hodiny naplno.
              slot.start % 60 === 0 && "border-border/40",
            )}
          >
            <TimeLabel start={slot.start} />
            {renderSlot(index)}
          </div>
        ))}
      </Card>
      {hint}
      {nowPill}
      {resizeGhost}
    </section>
  );
}

function isNowSlot(slot: SheetSlot, today: ISODate, now: number): boolean {
  return slot.date === today && now >= slot.start && now < slot.start + SHEET_SLOT;
}

/**
 * Popisek nesený prstem: nad prstem (ten ho jinak zakryje) a nikdy přes kraj
 * displeje. U horního kraje jde pod prst.
 */
export function ghostPosition(x: number, y: number): React.CSSProperties {
  const width = typeof window === "undefined" ? 400 : window.innerWidth;
  const margin = Math.min(width * 0.35, 150);
  return {
    left: Math.min(Math.max(x, margin), width - margin),
    top: y < 110 ? y + 40 : y - 76,
  };
}

/**
 * Je půlhodina „teď“ vidět? Když ne, nabídne se pilulka se směrem, kterým
 * leží. Sama se stránka neposouvá - trojka nahoře má zůstat to první, co
 * člověk po otevření vidí.
 */
function useNowPill(
  container: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  deps: unknown[],
): "up" | "down" | null {
  const [pill, setPill] = React.useState<"up" | "down" | null>(null);
  React.useEffect(() => {
    const el = enabled ? container.current?.querySelector("[data-timebox-now]") : null;
    if (!el) {
      setPill(null);
      return;
    }
    /* Jedno měření při rolování - stav se mění jen na hranách, takže se
       nepřekresluje nic. (IntersectionObserver by stačil taky, ale v okně,
       které zrovna nekreslí, nedá vědět vůbec a pilulka by chyběla.) */
    const check = () => {
      const rect = el.getBoundingClientRect();
      // Spodní lišta a pilulka samy zakrývají kus displeje - za ně se nepočítá.
      const bottom = window.innerHeight - 96;
      setPill(rect.bottom < 0 ? "up" : rect.top > bottom ? "down" : null);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, container, ...deps]);
  return pill;
}

/** Čas řádku - celé hodiny výrazně, půlhodiny potichu, ať se dá číst po hodinách. */
function TimeLabel({ start }: { start: number }) {
  const full = start % 60 === 0;
  return (
    <span
      className={cn(
        "tabular border-r px-1.5 pt-3.5 text-right text-xs leading-4",
        full ? "font-medium text-foreground" : "text-muted-foreground/70",
      )}
    >
      {formatMinutes(start)}
    </span>
  );
}

function Slot({
  date,
  start,
  blocks,
  editing,
  onEdit,
  onOpenBlock,
  next,
  drag,
  onResizePress,
  resizingId,
  highlighted,
  isNow,
}: {
  date: ISODate;
  start: number;
  blocks: TimeBlock[];
  editing: Editing | null;
  onEdit: (editing: Editing | null) => void;
  onOpenBlock: (id: string) => void;
  next: SheetSlot | null;
  drag: TimeboxDrag;
  onResizePress: (source: ResizeSource, event: React.PointerEvent<HTMLElement>) => void;
  resizingId: string | null;
  /** Políčko v rozsahu, kam by sahal protahovaný blok. */
  highlighted: boolean;
  isNow: boolean;
}) {
  const { state, addBlock, updateBlock, toggleBlockDone, deleteBlock, restoreBlock } = useStore();
  const { toast } = useToast();
  const content = slotContent(blocks, start);
  const isTarget =
    drag.target?.kind === "slot" && drag.target.date === date && drag.target.start === start;

  const onToggle = (block: TimeBlock) => {
    void (block.doneAt === null ? winFeedback() : tapFeedback());
    toggleBlockDone(block.id);
  };

  /** Švihnutí doleva: na zítra ve stejný čas - stejně jako v panelu bloku. */
  const onTomorrow = (block: TimeBlock) => {
    const from = block.date;
    updateBlock(block.id, { date: addDays(block.date, 1) });
    void tapFeedback();
    toast({
      tone: "info",
      title: `Na zítra ${formatMinutes(block.start)}`,
      description: blockTitle(state, block),
      action: { label: "Vrátit", onClick: () => updateBlock(block.id, { date: from }) },
    });
  };

  /**
   * Zápis políčka. Prázdný text u nového bloku nedělá nic, u existujícího ho
   * smaže - vygumovat řádek je na papíře totéž co ho škrtnout, jen tady jde
   * ještě vrátit.
   */
  const commit = (text: string, blockId: string | null, goNext: boolean) => {
    const value = text.trim();
    if (blockId === null) {
      if (value) addBlock({ date, start, duration: SHEET_SLOT, title: value });
    } else if (value) {
      updateBlock(blockId, { title: value });
    } else {
      const removed = deleteBlock(blockId);
      if (removed) {
        toast({
          tone: "info",
          title: "Odebráno",
          description: `${formatMinutes(removed.start)} ${blockTitle(state, removed)}`,
          action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
        });
      }
    }
    // Enter posouvá o půl hodiny dál, ať se den dá vyplnit bez zvedání prstu.
    onEdit(goNext && next ? { ...next, blockId: null } : null);
  };

  const writing = editing !== null && editing.blockId === null;

  return (
    <div
      data-slot=""
      data-slot-date={date}
      data-slot-start={start}
      {...(isNow ? { "data-timebox-now": "" } : {})}
      className={cn(
        "flex min-h-12 flex-col justify-center gap-px px-2 py-1 transition-colors",
        isNow && "bg-progress-muted/40",
        highlighted && "bg-progress/15",
        isTarget && "bg-progress/20 ring-1 ring-inset ring-progress",
      )}
    >
      {/* Dvě věci v jedné půlhodině stojí vedle sebe, ne pod sebou - dějí se
          naráz. Pod sebou vypadaly jako seznam kroků za sebou. */}
      {content.blocks.length > 0 || writing ? (
        /* Zalamuje se: dvě věci se vejdou vedle sebe, třetí si vezme řádek pod
           nimi. Bez toho se sloupce zmáčkly na pár písmen na řádek. */
        <div className="flex min-w-0 flex-wrap items-stretch gap-x-3 gap-y-1">
          {content.blocks.map((block) =>
            editing?.blockId === block.id ? (
              <SlotInput
                key={block.id}
                initial={block.title}
                onCommit={(text, goNext) => commit(text, block.id, goNext)}
                onCancel={() => onEdit(null)}
              />
            ) : (
              <BlockLine
                key={block.id}
                block={block}
                label={blockTitle(state, block)}
                linked={
                  block.todoId !== null || block.taskId !== null || block.priorityId !== null
                }
                offset={block.start !== start}
                dragging={
                  (drag.ghost?.source.kind === "block" && drag.ghost.source.id === block.id) ||
                  resizingId === block.id
                }
                onPress={(e) =>
                  drag.press({ kind: "block", id: block.id, title: blockTitle(state, block) }, e)
                }
                onResizePress={(e) =>
                  onResizePress({ id: block.id, title: blockTitle(state, block) }, e)
                }
                onToggle={() => onToggle(block)}
                onTomorrow={() => onTomorrow(block)}
                onOpen={() => onOpenBlock(block.id)}
              />
            ),
          )}
          {writing ? (
            <SlotInput
              initial=""
              onCommit={(text, goNext) => commit(text, null, goNext)}
              onCancel={() => onEdit(null)}
            />
          ) : null}
        </div>
      ) : null}

      {writing ? null : content.blocks.length === 0 ? (
        <button
          type="button"
          onClick={() => onEdit({ date, start, blockId: null })}
          aria-label={`Naplánovat na ${formatMinutes(start)}`}
          className="flex h-10 w-full items-center rounded-[4px] text-left hover:bg-accent/60"
        >
          {/* Delší blok tu jen pokračuje - popsaný je ve svém prvním políčku. */}
          {content.running ? (
            <span className="ml-0.5 h-8 w-0.5 rounded-full bg-progress/50" aria-hidden />
          ) : null}
        </button>
      ) : (
        /* Do jedné půlhodiny se vejde víc věcí - tenký proužek pod zápisy je
           říká nahlas, jinak by to nikoho nenapadlo zkusit. */
        <button
          type="button"
          onClick={() => onEdit({ date, start, blockId: null })}
          aria-label={`Přidat další na ${formatMinutes(start)}`}
          title="Přidat další"
          className="group flex h-5 w-full items-center justify-center rounded-[3px] border border-dashed border-transparent text-muted-foreground/50 hover:border-border hover:text-foreground"
        >
          <Plus className="size-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

/**
 * Jeden zápis v políčku. Zaškrtávátko odškrtává, ťuknutí na text otevře
 * panel bloku (text, čas, délka, na zítra, smazat). Malý křížek, který tu
 * dřív visel, je pryč - na telefonu se na něj ťukalo omylem.
 *
 * Švihnutí doprava odškrtne, doleva pošle na zítra a pilulka s délkou se dá
 * táhnout dolů - blok se protáhne do půlhodiny, kde se prst pustí.
 */
function BlockLine({
  block,
  label,
  linked,
  offset,
  dragging,
  onPress,
  onResizePress,
  onToggle,
  onTomorrow,
  onOpen,
}: {
  block: TimeBlock;
  label: string;
  linked: boolean;
  offset: boolean;
  dragging: boolean;
  onPress: (event: React.PointerEvent<HTMLElement>) => void;
  onResizePress: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle: () => void;
  onTomorrow: () => void;
  onOpen: () => void;
}) {
  const done = block.doneAt !== null;
  const swipe = useSwipeRow({ enabled: true, onRight: onToggle, onLeft: onTomorrow });
  const armedRight = swipe.offset >= SWIPE_THRESHOLD;
  const armedLeft = swipe.offset <= -SWIPE_THRESHOLD;

  const line = (
    <span
      onPointerDown={(e) => {
        onPress(e);
        swipe.handlers.onPointerDown(e);
      }}
      onPointerMove={swipe.handlers.onPointerMove}
      onPointerUp={swipe.handlers.onPointerUp}
      onPointerCancel={swipe.handlers.onPointerCancel}
      onClickCapture={swipe.handlers.onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
      data-no-swipe=""
      className={cn(
        "group/line relative flex min-h-10 touch-pan-y items-center gap-1 rounded-[3px] [-webkit-touch-callout:none]",
        // Při švihnutí kryje řádek to, co pod ním prosvítá; jinak je průhledný,
        // ať je vidět zvýraznění „teď“.
        swipe.offset !== 0 && "bg-card",
        dragging && "opacity-40",
      )}
      style={
        swipe.offset !== 0
          ? { transform: `translateX(${swipe.offset}px)` }
          : { transition: "transform 0.18s ease-out" }
      }
    >
      {/* Klikací plocha zaškrtávátka je na prst (44 px), vidět je jen malý čtvereček. */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? `Vrátit zpět: ${label}` : `Hotovo: ${label}`}
        className="-my-1 -ml-2 grid size-11 shrink-0 place-items-center"
      >
        <span
          className={cn(
            "grid size-5 place-items-center rounded-[4px] border transition-colors",
            done ? "border-progress bg-progress text-progress-foreground" : "border-muted-foreground/40",
          )}
        >
          {done ? <Check className="size-3.5" /> : null}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        title={label}
        className={cn(
          "min-w-0 flex-1 break-words py-2 text-left text-sm leading-5",
          done && "text-muted-foreground line-through",
        )}
      >
        {offset ? (
          <span className="tabular mr-1 text-muted-foreground">{formatMinutes(block.start)}</span>
        ) : null}
        {linked ? (
          <Link2 className="mr-0.5 inline size-3.5 text-muted-foreground" />
        ) : null}
        {label}
      </button>
      {/* Pilulka s délkou = úchyt pro protažení. Táhne hned (nic jiného
          neumí), takže si stránka nesmí vzít ani první pohyb. */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizePress(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`Délka ${formatLength(block.duration)} - táhni dolů a protáhni`}
        title="Táhni dolů a blok se protáhne. Ťuknutí otevře délky."
        className="tabular flex h-9 shrink-0 cursor-ns-resize touch-none items-center gap-0.5 rounded-full border px-2 text-[11px] text-muted-foreground [-webkit-touch-callout:none]"
      >
        <ChevronsUpDown className="size-3" />
        {formatLength(block.duration)}
      </button>
    </span>
  );

  /* Pod švihaným řádkem prosvítá, co se po puštění stane - a rozsvítí se, až
     je prst za hranicí. */
  return (
    <div className="relative min-w-[8rem] flex-[1_1_8rem] overflow-hidden rounded-[3px]">
      {swipe.offset !== 0 ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-3 text-xs font-semibold transition-colors",
            swipe.offset > 0 ? "justify-start" : "justify-end",
            armedRight
              ? "bg-progress text-progress-foreground"
              : armedLeft
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground",
          )}
        >
          {swipe.offset > 0 ? (done ? "Vrátit" : "Hotovo") : "Na zítra →"}
        </div>
      ) : null}
      {line}
    </div>
  );
}

function SlotInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (text: string, goNext: boolean) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);

  return (
    <AutoTextarea
      autoFocus
      value={draft}
      maxLength={TIMEBLOCK_MAX_TITLE}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft, false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft, true);
        }
        if (e.key === "Escape") onCancel();
      }}
      aria-label="Co se v tu dobu bude dít"
      className="min-w-[8rem] flex-[1_1_8rem] rounded-[4px] border bg-background px-2 py-2 text-sm leading-5"
    />
  );
}

/** Minuty od půlnoci, přepočítané jednou za minutu - kvůli zvýraznění "teď". */
function useNowMinutes(): number {
  const [minutes, setMinutes] = React.useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return minutes;
}

