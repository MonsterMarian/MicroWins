"use client";

import * as React from "react";
import { Check, Link2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback, winFeedback } from "@/lib/native";
import { blockTitle, formatMinutes, TIMEBLOCK_MAX_TITLE } from "@/lib/timeblocks";
import { SHEET_SLOT, slotContent, slotStart, timeboxRows } from "@/lib/timebox";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutoTextarea } from "./auto-textarea";
import type { TimeboxDrag } from "./use-timebox-drag";

/**
 * Mřížka time boxu: hodina na řádek, sloupce `:00` a `:30`.
 *
 * Políčko **nemá vlastní data** - je to blok Plánu dne (`lib/timeblocks.ts`).
 * Do jedné půlhodiny se jich vejde víc (plán překryvy povoluje odjakživa)
 * a přetáhnout se dají prstem jinam; dlouhý text políčko neusekne, jen mu
 * naroste řádek.
 */

/** Které políčko se zrovna píše. `blockId: null` = nový blok. */
interface Editing {
  date: ISODate;
  start: number;
  blockId: string | null;
}

interface SlotRef {
  date: ISODate;
  start: number;
}

export function TimeboxGrid({
  date,
  today,
  drag,
  className,
}: {
  date: ISODate;
  today: ISODate;
  /** Tažení drží panel - přetahuje se i mezi trojkou hlavních věcí a mřížkou. */
  drag: TimeboxDrag;
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

  const slotCount = rows.length * 2;

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
                const start = slotStart(row.hour, half);
                const slot = index * 2 + (half ? 1 : 0);
                return (
                  <Slot
                    key={half ? "half" : "full"}
                    date={row.date}
                    start={start}
                    blocks={blocks}
                    editing={
                      editing && editing.date === row.date && editing.start === start
                        ? editing
                        : null
                    }
                    onEdit={setEditing}
                    next={
                      slot + 1 < slotCount
                        ? slotAt(rows, slot + 1)
                        : null
                    }
                    drag={drag}
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
        Ťukni do políčka a piš; Enter tě posune o půl hodiny dál. Zápis se dá přetáhnout jinam,
        nahoru mezi hlavní věci dne, nebo dolů do koše. Je to stejný den jako v Plánu, takže co
        tu odškrtneš, je odškrtnuté i tam.
      </p>
    </section>
  );
}

/** Den a čas políčka podle jeho pořadí v mřížce. */
function slotAt(rows: { hour: number; date: ISODate }[], slot: number): SlotRef {
  const row = rows[Math.floor(slot / 2)];
  return { date: row.date, start: slotStart(row.hour, slot % 2 === 1) };
}

function Slot({
  date,
  start,
  blocks,
  editing,
  onEdit,
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
  next: SlotRef | null;
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
          title: "Smazáno",
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
      className={cn(
        "flex min-h-[2rem] flex-col justify-center gap-px py-0.5 pl-1 pr-0.5 transition-colors",
        isNow && "bg-progress-muted/40",
        isTarget && "bg-progress/20 ring-1 ring-inset ring-progress",
        className,
      )}
    >
      {/* Dvě věci v jedné půlhodině stojí vedle sebe, ne pod sebou - stejně
          jako překryté bloky v Plánu. Pod sebou vypadaly jako seznam kroků
          za sebou, přitom se dějí naráz. */}
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
                dragging={
                  drag.ghost?.source.kind === "block" && drag.ghost.source.id === block.id
                }
                onPress={(e) =>
                  drag.press({ kind: "block", id: block.id, title: blockTitle(state, block) }, e)
                }
                onToggle={() => onToggle(block)}
                onEdit={() => onEdit({ date, start, blockId: block.id })}
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
          {/* Delší blok z Plánu tu jen pokračuje - popsaný je ve svém prvním políčku. */}
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
 * Jeden zápis v políčku. Zaškrtávátko odškrtává, text se přepisuje - ale jen
 * u bloku, který si text nese sám. Blok z ToDo, z úkolu nebo z hlavní věci dne
 * zobrazuje jejich jméno, takže přepsat ho tady by vypadalo, že se nic nestalo:
 * uložilo by se do bloku a na obrazovce by dál svítil původní text odkazu.
 * Ťuknutí na takový zápis proto odškrtává a sundat se dá tahem do koše.
 */
function BlockLine({
  block,
  label,
  linked,
  offset,
  dragging,
  onPress,
  onToggle,
  onEdit,
}: {
  block: TimeBlock;
  label: string;
  linked: boolean;
  offset: boolean;
  dragging: boolean;
  onPress: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const done = block.doneAt !== null;

  return (
    <span
      onPointerDown={onPress}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "flex min-w-[4.5rem] flex-[1_1_4.5rem] items-start gap-1 rounded-[3px] [-webkit-touch-callout:none]",
        dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? `Vrátit zpět: ${label}` : `Hotovo: ${label}`}
        className={cn(
          "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors",
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
