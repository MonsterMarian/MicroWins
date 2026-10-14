"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, Link2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback, winFeedback } from "@/lib/native";
import { blockTitle, formatMinutes, TIMEBLOCK_MAX_TITLE } from "@/lib/timeblocks";
import { SHEET_SLOT, slotContent, timeboxRows, timeboxSlots, type SheetSlot } from "@/lib/timebox";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutoTextarea } from "./auto-textarea";
import type { TimeboxDrag } from "./use-timebox-drag";

/**
 * Mřížka time boxu: papírový list - hodina na řádek, sloupce `:00` a `:30`.
 *
 * Políčko **nemá vlastní data** - je to časový blok (`lib/timeblocks.ts`).
 * Do jedné půlhodiny se jich vejde víc (překryvy appka povoluje odjakživa)
 * a přetáhnout se dají prstem jinam; dlouhý text políčko neusekne, jen mu
 * naroste řádek.
 *
 * Papír, protože je nejhutnější: celý den je vidět na pár obrazovkách a každá
 * půlhodina (i prázdná) je na svém místě. Seznam s půlhodinou na řádek byl
 * na telefonu moc roztažený a slévání volna do řádku „volno“ zase schovávalo
 * místa, kam se dá ťuknout. Ťuknutí na zápis otevře panel bloku s časem,
 * délkou, odškrtnutím i „na zítra“.
 */

/** Které políčko se zrovna píše. `blockId: null` = nový blok. */
interface Editing {
  date: ISODate;
  start: number;
  blockId: string | null;
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
  const { state } = useStore();
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

  const dragging = drag.ghost !== null;

  const isEditing = (slot: SheetSlot) =>
    editing !== null && editing.date === slot.date && editing.start === slot.start;

  const renderSlot = (index: number, className?: string) => {
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
        isNow={isNowSlot(slot, today, now)}
        className={className}
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

  return (
    <section ref={container} className={cn("flex flex-col gap-1.5", className)}>
      <div className="tabular grid grid-cols-[2.1rem_minmax(0,1fr)_minmax(0,1fr)] px-0.5 text-[11px] text-muted-foreground">
        <span />
        <span className="pl-1.5">:00</span>
        <span className="pl-1.5">:30</span>
      </div>

      <Card className="-mx-4 overflow-hidden rounded-none border-x-0 p-0 sm:mx-0 sm:rounded-xl sm:border-x">
        {rows.map((row, index) => (
          <div
            key={`${row.date}-${row.hour}`}
            className="grid grid-cols-[2.1rem_minmax(0,1fr)_minmax(0,1fr)] border-b last:border-b-0"
          >
            <span className="tabular grid place-items-center border-r py-1 text-[11px] text-muted-foreground">
              {row.hour}
            </span>
            {renderSlot(index * 2)}
            {renderSlot(index * 2 + 1, "border-l")}
          </div>
        ))}
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Ťukni do políčka a piš; Enter tě posune o půl hodiny dál. Ťuknutí na zápis otevře jeho čas,
        délku a akce; podržený se dá přetáhnout jinam, mezi hlavní věci dne, nebo do koše.
      </p>
      {nowPill}
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

function Slot({
  date,
  start,
  blocks,
  editing,
  onEdit,
  onOpenBlock,
  next,
  drag,
  isNow,
  className,
}: {
  date: ISODate;
  start: number;
  blocks: TimeBlock[];
  editing: Editing | null;
  onEdit: (editing: Editing | null) => void;
  onOpenBlock: (id: string) => void;
  next: SheetSlot | null;
  drag: TimeboxDrag;
  isNow: boolean;
  className?: string;
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
        "flex min-h-[2rem] flex-col justify-center gap-px py-0.5 pl-1 pr-0.5 transition-colors",
        isNow && "bg-progress-muted/40",
        isTarget && "bg-progress/20 ring-1 ring-inset ring-progress",
        className,
      )}
    >
      {/* Dvě věci v jedné půlhodině stojí vedle sebe, ne pod sebou - dějí se
          naráz. Pod sebou vypadaly jako seznam kroků za sebou. */}
      {content.blocks.length > 0 || writing ? (
        /* Zalamuje se: dvě věci se vejdou vedle sebe, třetí si vezme řádek pod
           nimi. Bez toho se sloupce zmáčkly na pár písmen na řádek. */
        <div className="flex min-w-0 flex-wrap items-stretch gap-px">
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
                dragging={drag.ghost?.source.kind === "block" && drag.ghost.source.id === block.id}
                onPress={(e) =>
                  drag.press({ kind: "block", id: block.id, title: blockTitle(state, block) }, e)
                }
                onToggle={() => onToggle(block)}
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
          className="flex h-6 w-full items-center rounded-[4px] text-left hover:bg-accent/60"
        >
          {/* Delší blok tu jen pokračuje - popsaný je ve svém prvním políčku. */}
          {content.running ? (
            <span className="ml-0.5 h-3.5 w-0.5 rounded-full bg-progress/50" aria-hidden />
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
          className="group flex h-3.5 w-full items-center justify-center rounded-[3px] border border-dashed border-transparent text-muted-foreground/50 hover:border-border hover:text-foreground"
        >
          <Plus className="size-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

/**
 * Jeden zápis v políčku. Zaškrtávátko odškrtává, ťuknutí na text otevře
 * panel bloku (text, čas, délka, na zítra, smazat), podržení ho přetáhne.
 * Malý křížek, který tu dřív visel, je pryč - na telefonu se na něj ťukalo
 * omylem.
 */
function BlockLine({
  block,
  label,
  linked,
  offset,
  dragging,
  onPress,
  onToggle,
  onOpen,
}: {
  block: TimeBlock;
  label: string;
  linked: boolean;
  offset: boolean;
  dragging: boolean;
  onPress: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = block.doneAt !== null;

  return (
    <span
      onPointerDown={onPress}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "group/line relative flex min-w-[4.5rem] flex-[1_1_4.5rem] items-start gap-1 rounded-[3px] [-webkit-touch-callout:none]",
        dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? `Vrátit zpět: ${label}` : `Hotovo: ${label}`}
        className="mt-0.5 grid shrink-0 place-items-center"
      >
        <span
          className={cn(
            "grid size-3.5 place-items-center rounded-[3px] border transition-colors",
            done ? "border-progress bg-progress text-progress-foreground" : "border-muted-foreground/40",
          )}
        >
          {done ? <Check className="size-2.5" /> : null}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        title={label}
        className={cn(
          "min-w-0 flex-1 break-words text-left text-[11px] leading-4",
          done && "text-muted-foreground line-through",
        )}
      >
        {offset ? (
          <span className="tabular mr-1 text-muted-foreground">{formatMinutes(block.start)}</span>
        ) : null}
        {linked ? <Link2 className="mr-0.5 inline size-2.5 text-muted-foreground" /> : null}
        {label}
      </button>
    </span>
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
      className="min-w-[4.5rem] flex-[1_1_4.5rem] rounded-[4px] border bg-background px-1 py-0.5 text-[11px] leading-4"
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
