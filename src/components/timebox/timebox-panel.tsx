"use client";

import * as React from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, DAY_SHORT, formatDate, fromISODate } from "@/lib/date";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  blocksOfDay,
  blockTitle,
  doneMinutes,
  formatLength,
  formatMinutes,
  plannedMinutes,
  TIMEBLOCK_MAX_TITLE,
} from "@/lib/timeblocks";
import {
  PRIORITY_COUNT,
  PRIORITY_MAX,
  SHEET_SLOT,
  sheetOf,
  slotContent,
  slotStart,
  timeboxRows,
} from "@/lib/timebox";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * Time box - papírový list dne přenesený do appky.
 *
 * Mřížka jede po půlhodinách a **nemá vlastní data**: políčko je blok plánu,
 * takže co se sem napíše, stojí i v Plánu dne a odškrtává se jednou. Vedle ní
 * jsou dvě věci, co k plánu nepatří, ale ke dni ano: tři hlavní priority
 * a brain dump.
 *
 * Všechno je schválně drobné. List má odpovídat na "co mě dnes čeká" jedním
 * pohledem, takže se na výšku telefonu musí vejít co nejvíc řádků - proto
 * hodina na řádek a dva sloupce (`:00`, `:30`), ne jeden řádek na půlhodinu.
 */
export function TimeboxPanel() {
  const { today } = useStore();
  const [date, setDate] = React.useState<ISODate>(() => today);

  return (
    <div className="flex flex-col gap-3">
      <DateBar date={date} today={today} onDate={setDate} />
      {/* Klíč podle dne: rozepsané texty patří tomu dni, ne políčku na obrazovce. */}
      <div
        key={date}
        className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
      >
        <Priorities date={date} className="sm:col-start-1 sm:row-start-1" />
        <Grid date={date} today={today} className="sm:col-start-2 sm:row-span-2 sm:row-start-1" />
        <BrainDump date={date} className="sm:col-start-1 sm:row-start-2" />
      </div>
    </div>
  );
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

function Priorities({ date, className }: { date: ISODate; className?: string }) {
  const { state, setPriority } = useStore();
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
            value={sheet.priorities[i] ?? ""}
            onCommit={(text) => setPriority(date, i, text)}
          />
        ))}
      </Card>
    </section>
  );
}

function PriorityRow({
  index,
  value,
  onCommit,
}: {
  index: number;
  value: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft, flush] = useDraft(value, onCommit);

  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5">
      <span className="tabular grid size-5 shrink-0 place-items-center rounded-[5px] border text-[11px] text-muted-foreground">
        {index + 1}
      </span>
      <input
        value={draft}
        maxLength={PRIORITY_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={`${index + 1}. priorita dne`}
        placeholder={index === 0 ? "Co musí dnes padnout" : ""}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/60"
      />
    </label>
  );
}

// --- brain dump -------------------------------------------------------------

function BrainDump({ date, className }: { date: ISODate; className?: string }) {
  const { state, setBrainDump } = useStore();
  const sheet = sheetOf(state, date);
  const [draft, setDraft, flush] = useDraft(sheet.brainDump, (text) => setBrainDump(date, text));

  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <h3 className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Brain dump
      </h3>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        placeholder="Co se honí hlavou a nemá to čas ani pořadí"
        aria-label="Brain dump"
        className="min-h-40 resize-y text-sm leading-6"
        /* Tečkovaná plocha jako na papírovém listu - psát se dá kamkoliv. */
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />
    </section>
  );
}

// --- mřížka -----------------------------------------------------------------

/** Které políčko se zrovna píše. `blockId: null` = nový blok. */
interface Editing {
  slot: number;
  blockId: string | null;
}

function Grid({
  date,
  today,
  className,
}: {
  date: ISODate;
  today: ISODate;
  className?: string;
}) {
  const { state } = useStore();
  const { timeboxStart, timeboxEnd } = usePrefs();
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const now = useNowMinutes();

  const rows = React.useMemo(
    () => timeboxRows(date, timeboxStart, timeboxEnd),
    [date, timeboxStart, timeboxEnd],
  );

  /* Mřížka může přetéct přes půlnoc, takže dnů bývá víc než jeden - bloky se
     proto berou pro každý den zvlášť a ne jednou pro `date`. */
  const blocksByDate = React.useMemo(() => {
    const map = new Map<ISODate, TimeBlock[]>();
    for (const row of rows) {
      if (!map.has(row.date)) map.set(row.date, blocksOfDay(state, row.date));
    }
    return map;
  }, [state, rows]);

  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <div className="tabular grid grid-cols-[2.1rem_minmax(0,1fr)_minmax(0,1fr)] px-0.5 text-[11px] text-muted-foreground">
        <span />
        <span className="pl-1.5">:00</span>
        <span className="pl-1.5">:30</span>
      </div>

      <Card className="-mx-4 overflow-hidden rounded-none border-x-0 p-0 sm:mx-0 sm:rounded-xl sm:border-x">
        {rows.map((row, index) => {
          const blocks = blocksByDate.get(row.date) ?? [];
          return (
            <div
              key={`${row.date}-${row.hour}`}
              className="grid grid-cols-[2.1rem_minmax(0,1fr)_minmax(0,1fr)] border-b last:border-b-0"
            >
              <span className="tabular grid place-items-center border-r py-1 text-[11px] text-muted-foreground">
                {row.hour}
              </span>
              {[false, true].map((half) => {
                const slot = index * 2 + (half ? 1 : 0);
                const start = slotStart(row.hour, half);
                return (
                  <Slot
                    key={half ? "half" : "full"}
                    date={row.date}
                    start={start}
                    blocks={blocks}
                    slot={slot}
                    editing={editing?.slot === slot ? editing : null}
                    onEdit={setEditing}
                    lastSlot={rows.length * 2 - 1}
                    isNow={row.date === today && now >= start && now < start + SHEET_SLOT}
                    className={half ? "border-l" : ""}
                  />
                );
              })}
            </div>
          );
        })}
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Ťukni do políčka a piš; Enter tě posune o půl hodiny dál. Je to stejný den jako v Plánu,
        takže co tu odškrtneš, je odškrtnuté i tam.
      </p>
    </section>
  );
}

function Slot({
  date,
  start,
  blocks,
  slot,
  editing,
  onEdit,
  lastSlot,
  isNow,
  className,
}: {
  date: ISODate;
  start: number;
  blocks: TimeBlock[];
  slot: number;
  editing: Editing | null;
  onEdit: (editing: Editing | null) => void;
  lastSlot: number;
  isNow: boolean;
  className?: string;
}) {
  const { state, addBlock, updateBlock, toggleBlockDone, deleteBlock, restoreBlock } = useStore();
  const { toast } = useToast();
  const content = slotContent(blocks, start);

  const onToggle = (block: TimeBlock) => {
    void (block.doneAt === null ? winFeedback() : tapFeedback());
    toggleBlockDone(block.id);
  };

  /**
   * Zápis políčka. Prázdný text u nového bloku nedělá nic, u existujícího ho
   * smaže - vygumovat řádek je na papíře totéž co ho škrtnout, jen tady jde
   * ještě vrátit.
   */
  const commit = (text: string, blockId: string | null, next: boolean) => {
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
          title: "Smazáno",
          description: `${formatMinutes(removed.start)} ${blockTitle(state, removed)}`,
          action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
        });
      }
    }
    // Enter posouvá o půl hodiny dál, ať se den dá vyplnit bez zvedání prstu.
    onEdit(next && slot < lastSlot ? { slot: slot + 1, blockId: null } : null);
  };

  const editingNew = editing !== null && editing.blockId === null;

  return (
    <div
      className={cn(
        "flex min-h-[2rem] flex-col justify-center gap-px py-0.5 pl-1 pr-0.5",
        isNow && "bg-progress-muted/40",
        className,
      )}
    >
      {content.blocks.map((block) =>
        editing?.blockId === block.id ? (
          <SlotInput
            key={block.id}
            initial={block.title}
            onCommit={(text, next) => commit(text, block.id, next)}
            onCancel={() => onEdit(null)}
          />
        ) : (
          <BlockLine
            key={block.id}
            block={block}
            label={blockTitle(state, block)}
            linked={block.todoId !== null || block.taskId !== null}
            offset={block.start !== start}
            onToggle={() => onToggle(block)}
            onEdit={() => onEdit({ slot, blockId: block.id })}
          />
        ),
      )}

      {editingNew ? (
        <SlotInput
          initial=""
          onCommit={(text, next) => commit(text, null, next)}
          onCancel={() => onEdit(null)}
        />
      ) : content.blocks.length === 0 ? (
        <button
          type="button"
          onClick={() => onEdit({ slot, blockId: null })}
          aria-label={`Naplánovat na ${formatMinutes(start)}`}
          className="flex h-6 w-full items-center rounded-[4px] text-left hover:bg-accent/60"
        >
          {/* Delší blok z Plánu tu jen pokračuje - popsaný je ve svém prvním políčku. */}
          {content.running ? (
            <span className="ml-0.5 h-3.5 w-0.5 rounded-full bg-progress/50" aria-hidden />
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Jeden blok v políčku. Zaškrtávátko odškrtává, text se přepisuje - ale jen
 * u bloku, který si text nese sám. Blok z ToDo nebo z úkolu zobrazuje jejich
 * jméno, takže přepsat ho tady by vypadalo, že se nic nestalo.
 */
function BlockLine({
  block,
  label,
  linked,
  offset,
  onToggle,
  onEdit,
}: {
  block: TimeBlock;
  label: string;
  linked: boolean;
  offset: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const done = block.doneAt !== null;

  return (
    <span className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? `Vrátit zpět: ${label}` : `Hotovo: ${label}`}
        className={cn(
          "grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors",
          done ? "border-progress bg-progress text-progress-foreground" : "border-muted-foreground/40",
        )}
      >
        {done ? <Check className="size-2.5" /> : null}
      </button>
      <button
        type="button"
        onClick={linked ? onToggle : onEdit}
        title={label}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[11px] leading-4",
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
  onCommit: (text: string, next: boolean) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);

  return (
    <Input
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
      className="h-6 rounded-[4px] px-1 text-[11px]"
    />
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
