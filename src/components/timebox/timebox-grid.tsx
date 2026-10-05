"use client";

import * as React from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback } from "@/lib/native";
import {
  blockLink,
  blockTitle,
  formatLength,
  formatMinutes,
  TIMEBLOCK_MAX_TITLE,
  type BlockLink,
} from "@/lib/timeblocks";
import { SHEET_SLOT, slotContent, slotStart, timeboxRows } from "@/lib/timebox";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutoTextarea } from "./auto-textarea";
import { CheckButton } from "./check-button";
import type { TimeboxDrag } from "./use-timebox-drag";

/**
 * Mřížka time boxu: hodina na řádek, sloupce `:00` a `:30`.
 *
 * Políčko **nemá vlastní data** - je to časový blok (`lib/timeblocks.ts`).
 * Do jedné půlhodiny se jich vejde víc (překryvy appka povoluje odjakživa)
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

/**
 * Jak se mřížka kreslí. `sheet` je papírový list se sloupci `:00` a `:30`,
 * `list` půlhodina na řádek přes celou šířku a `agenda` totéž, jen se prázdné
 * půlhodiny slijí do jednoho řádku volna.
 */
export type GridLayout = "sheet" | "list" | "agenda";

export function TimeboxGrid({
  date,
  today,
  drag,
  layout = "sheet",
  className,
}: {
  date: ISODate;
  today: ISODate;
  /** Tažení drží panel - přetahuje se i mezi trojkou hlavních věcí a mřížkou. */
  drag: TimeboxDrag;
  layout?: GridLayout;
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

  /** Všechna políčka po sobě - Enter posouvá na další, i přes konec hodiny. */
  const slots = React.useMemo(
    () =>
      rows.flatMap((row) =>
        [false, true].map((half) => ({ date: row.date, start: slotStart(row.hour, half) })),
      ),
    [rows],
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

  const isEditing = (slot: SlotRef) =>
    editing !== null && editing.date === slot.date && editing.start === slot.start;

  const renderSlot = (index: number, props: { roomy?: boolean; className?: string } = {}) => {
    const slot = slots[index];
    return (
      <Slot
        date={slot.date}
        start={slot.start}
        blocks={blocksByDate.get(slot.date) ?? []}
        editing={isEditing(slot) ? editing : null}
        onEdit={setEditing}
        next={slots[index + 1] ?? null}
        drag={drag}
        isNow={isNowSlot(slot, today, now)}
        {...props}
      />
    );
  };

  const hint = (
    <p className="px-1 text-xs text-muted-foreground">
      Ťukni do políčka a piš; Enter tě posune o půl hodiny dál. Ťuknutím na zápis ho přepíšeš
      nebo smažeš, podržením přetáhneš jinam. Odškrtnutí platí i v ToDo a u hlavních věcí dne;
      úkolu projektu se postup nemění - ten se počítá u úkolu.
    </p>
  );

  if (layout !== "sheet") {
    const occupied = (slot: SlotRef) => {
      const content = slotContent(blocksByDate.get(slot.date) ?? [], slot.start);
      return (
        content.blocks.length > 0 ||
        content.running !== null ||
        isNowSlot(slot, today, now) ||
        isEditing(slot)
      );
    };
    const items = listItems(slots, layout, occupied, drag.ghost !== null);

    return (
      <section className={cn("flex flex-col gap-1.5", className)}>
        <Card className="-mx-4 overflow-hidden rounded-none border-x-0 p-0 sm:mx-0 sm:rounded-xl sm:border-x">
          {items.map((item) => {
            if (item.kind === "free") {
              const from = slots[item.from];
              return (
                <FreeRow
                  key={`${from.date}-${from.start}-free`}
                  from={from}
                  count={item.count}
                  onEdit={() => setEditing({ ...from, blockId: null })}
                />
              );
            }
            const slot = slots[item.index];
            return (
              <div
                key={`${slot.date}-${slot.start}`}
                className={cn(
                  "grid grid-cols-[3rem_minmax(0,1fr)] border-b last:border-b-0",
                  // Půlhodina uvnitř hodiny se odděluje jen jemně, hodiny naplno.
                  layout === "list" && slot.start % 60 === 0 && "border-border/40",
                )}
              >
                <TimeLabel start={slot.start} />
                {renderSlot(item.index, { roomy: true })}
              </div>
            );
          })}
        </Card>
        {hint}
      </section>
    );
  }

  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
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
            {[false, true].map((half) => (
              <React.Fragment key={half ? "half" : "full"}>
                {renderSlot(index * 2 + (half ? 1 : 0), { className: half ? "border-l" : "" })}
              </React.Fragment>
            ))}
          </div>
        ))}
      </Card>

      {hint}
    </section>
  );
}

function isNowSlot(slot: SlotRef, today: ISODate, now: number): boolean {
  return slot.date === today && now >= slot.start && now < slot.start + SHEET_SLOT;
}

type ListItem = { kind: "slot"; index: number } | { kind: "free"; from: number; count: number };

/**
 * Řádky jednosloupcové mřížky. V seznamu je to každá půlhodina, v agendě jen
 * ty, kde něco je (nebo je teď, nebo se zrovna píšou) - prázdné mezi nimi
 * se slijí do jednoho řádku volna.
 *
 * Při tažení se agenda rozbalí celá: volno slité do řádku by šlo pustit jen
 * na jeho začátek, a z přesunu na 14:30 by byl přesun na 12:00.
 */
function listItems(
  slots: SlotRef[],
  layout: "list" | "agenda",
  occupied: (slot: SlotRef) => boolean,
  expanded: boolean,
): ListItem[] {
  if (layout === "list" || expanded) return slots.map((_, index) => ({ kind: "slot", index }));
  const out: ListItem[] = [];
  slots.forEach((slot, index) => {
    if (occupied(slot)) {
      out.push({ kind: "slot", index });
      return;
    }
    const last = out[out.length - 1];
    if (last?.kind === "free") last.count += 1;
    else out.push({ kind: "free", from: index, count: 1 });
  });
  return out;
}

/** Čas řádku - celé hodiny výrazně, půlhodiny potichu, ať se dá číst po hodinách. */
function TimeLabel({ start }: { start: number }) {
  const full = start % 60 === 0;
  return (
    <span
      className={cn(
        "tabular border-r px-1.5 pt-2.5 text-right text-xs leading-4",
        full ? "font-medium text-foreground" : "text-muted-foreground/70",
      )}
    >
      {formatMinutes(start)}
    </span>
  );
}

/** Slité volno v agendě. Ťuknutí začne psát do jeho první půlhodiny. */
function FreeRow({ from, count, onEdit }: { from: SlotRef; count: number; onEdit: () => void }) {
  const end = from.start + count * SHEET_SLOT;
  return (
    <div
      data-slot=""
      data-slot-date={from.date}
      data-slot-start={from.start}
      className="grid grid-cols-[3rem_minmax(0,1fr)] border-b last:border-b-0"
    >
      <span className="tabular border-r px-1.5 py-2 text-right text-xs text-muted-foreground/70">
        {formatMinutes(from.start)}
      </span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Naplánovat na ${formatMinutes(from.start)}`}
        className="flex items-center gap-2 px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent/60"
      >
        <span className="h-px flex-1 border-t border-dashed" />
        <span className="tabular shrink-0">
          volno {formatLength(count * SHEET_SLOT)} · do {formatMinutes(end)}
        </span>
        <Plus className="size-3.5 shrink-0" />
      </button>
    </div>
  );
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
  roomy = false,
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
  /** Políčko přes celou šířku (seznam, agenda) - větší písmo a prsty. */
  roomy?: boolean;
  className?: string;
}) {
  const { state, addBlock, updateBlock, toggleBlockDone, deleteBlock, restoreBlock } = useStore();
  const { toast } = useToast();
  const content = slotContent(blocks, start);
  const isTarget =
    drag.target?.kind === "slot" && drag.target.date === date && drag.target.start === start;

  /** Sundá zápis z mřížky - s cestou zpátky, ať se omyl dá vrátit. */
  const remove = (blockId: string) => {
    const removed = deleteBlock(blockId);
    if (!removed) return;
    void tapFeedback();
    toast({
      tone: "info",
      title: "Smazáno",
      description: `${formatMinutes(removed.start)} ${blockTitle(state, removed)}`,
      action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
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
      remove(blockId);
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
        "flex flex-col justify-center gap-px transition-colors",
        roomy ? "min-h-[2.5rem] px-2 py-1" : "min-h-[2rem] py-0.5 pl-1 pr-0.5",
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
        <div className={cn("flex min-w-0 flex-wrap items-stretch", roomy ? "gap-x-3 gap-y-1" : "gap-px")}>
          {content.blocks.map((block) => {
            const label = blockTitle(state, block);
            const link = blockLink(state, block);
            if (editing?.blockId === block.id) {
              return link ? (
                <LinkedEdit
                  key={block.id}
                  roomy={roomy}
                  label={label}
                  link={link}
                  onDelete={() => {
                    remove(block.id);
                    onEdit(null);
                  }}
                  onClose={() => onEdit(null)}
                />
              ) : (
                <SlotInput
                  key={block.id}
                  roomy={roomy}
                  initial={block.title}
                  onCommit={(text, goNext) => commit(text, block.id, goNext)}
                  onCancel={() => onEdit(null)}
                  onDelete={() => {
                    remove(block.id);
                    onEdit(null);
                  }}
                />
              );
            }
            return (
              <BlockLine
                key={block.id}
                roomy={roomy}
                block={block}
                label={label}
                linked={link !== null}
                offset={block.start !== start}
                dragging={drag.ghost?.source.kind === "block" && drag.ghost.source.id === block.id}
                onPress={(e) => drag.press({ kind: "block", id: block.id, title: label }, e)}
                onToggle={() => toggleBlockDone(block.id)}
                onEdit={() => onEdit({ date, start, blockId: block.id })}
              />
            );
          })}
          {writing ? (
            <SlotInput
              roomy={roomy}
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
          className={cn(
            "flex w-full items-center rounded-[4px] text-left hover:bg-accent/60",
            roomy ? "h-8" : "h-6",
          )}
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
 * úpravu (u navázaného zápisu jen koš - text si bere z věci, na kterou
 * ukazuje) a podržení zápis zvedne a dá se přetáhnout.
 *
 * Dřív ťuknutí na navázaný zápis odškrtávalo, takže ho nešlo nijak smazat
 * kromě tahu do koše, o kterém nikdo nevěděl - a odškrtnutí měl řádek už
 * jednou, v rámečku vedle.
 */
function BlockLine({
  roomy,
  block,
  label,
  linked,
  offset,
  dragging,
  onPress,
  onToggle,
  onEdit,
}: {
  roomy: boolean;
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
        "flex items-start rounded-[3px] [-webkit-touch-callout:none]",
        roomy ? "min-w-[8rem] flex-[1_1_8rem] gap-2 py-1" : "min-w-[4.5rem] flex-[1_1_4.5rem] gap-1",
        dragging && "opacity-40",
      )}
    >
      <CheckButton
        done={done}
        label={label}
        onToggle={onToggle}
        size={roomy ? "md" : "sm"}
        className={roomy ? "mt-px" : "mt-0.5"}
      />
      <button
        type="button"
        onClick={onEdit}
        title={linked ? `${label} - ťukni pro smazání z mřížky` : label}
        className={cn(
          "min-w-0 flex-1 break-words text-left",
          roomy ? "text-sm leading-5" : "text-[11px] leading-4",
          done && "text-muted-foreground line-through",
        )}
      >
        {offset ? (
          <span className="tabular mr-1 text-muted-foreground">{formatMinutes(block.start)}</span>
        ) : null}
        {linked ? (
          <Link2
            className={cn("mr-0.5 inline text-muted-foreground", roomy ? "size-3.5" : "size-2.5")}
          />
        ) : null}
        {label}
      </button>
    </span>
  );
}

/** Odkud navázaný zápis bere text - tam se dá přejmenovat. */
const LINK_ORIGIN = {
  priority: "z hlavních věcí dne",
  todo: "z ToDo",
  task: "z úkolu projektu",
} as const;

/**
 * Otevřený navázaný zápis: text se tu přepsat nedá (bere ho z věci, na kterou
 * ukazuje), takže úprava je jen koš a poznámka, kde se dá přejmenovat.
 * Zavře se ťuknutím kamkoliv jinam nebo Escapem.
 */
function LinkedEdit({
  roomy,
  label,
  link,
  onDelete,
  onClose,
}: {
  roomy: boolean;
  label: string;
  link: BlockLink;
  onDelete: () => void;
  onClose: () => void;
}) {
  const box = React.useRef<HTMLDivElement | null>(null);
  const close = React.useRef(onClose);
  close.current = onClose;

  /* Na zavření se nečeká na blur: na iPhonu ťuknutí na nefokusovatelné místo
     fokus nepřesune a úprava by zůstala viset. */
  React.useEffect(() => {
    box.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <div
      ref={box}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className={cn(
        "flex items-start gap-1 rounded-[4px] border bg-background outline-none",
        roomy
          ? "min-w-[8rem] flex-[1_1_8rem] px-2 py-1 text-sm leading-5"
          : "min-w-[4.5rem] flex-[1_1_4.5rem] px-1 py-0.5 text-[11px] leading-4",
      )}
    >
      <span className="min-w-0 flex-1 break-words">
        {label}
        <span className="block text-muted-foreground">{LINK_ORIGIN[link]}</span>
      </span>
      <DeleteButton roomy={roomy} label={label} onDelete={onDelete} />
    </div>
  );
}

/**
 * Koš u otevřeného zápisu. `mousedown` se zastaví, aby pole nepřišlo
 * o fokus dřív, než se ťuknutí dokončí - blur by úpravu zavřel a koš by
 * zmizel pod prstem.
 */
function DeleteButton({
  roomy,
  label,
  onDelete,
}: {
  roomy: boolean;
  label: string;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onDelete}
      aria-label={`Smazat z mřížky: ${label}`}
      title="Smazat z mřížky"
      className={cn(
        "grid shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive",
        roomy ? "size-6" : "-my-0.5 size-5",
      )}
    >
      <Trash2 className={roomy ? "size-4" : "size-3.5"} />
    </button>
  );
}

function SlotInput({
  roomy,
  initial,
  onCommit,
  onCancel,
  onDelete,
}: {
  roomy: boolean;
  initial: string;
  onCommit: (text: string, goNext: boolean) => void;
  onCancel: () => void;
  /** Jen u existujícího zápisu - nový nemá co mazat. */
  onDelete?: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  /* Uložit se smí jednou: Enter uloží a posune dál, a následný blur
     (pole mizí) by stejný text uložil podruhé - u nového zápisu by vznikl
     dvakrát. */
  const settled = React.useRef(false);
  const settle = (goNext: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onCommit(draft, goNext);
  };

  return (
    <span
      className={cn(
        "flex items-start gap-0.5 rounded-[4px] border bg-background",
        roomy
          ? "min-w-[8rem] flex-[1_1_8rem] px-2 py-1"
          : "min-w-[4.5rem] flex-[1_1_4.5rem] px-1 py-0.5",
      )}
    >
      <AutoTextarea
        autoFocus
        value={draft}
        maxLength={TIMEBLOCK_MAX_TITLE}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => settle(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            settle(true);
          }
          if (e.key === "Escape") {
            settled.current = true;
            onCancel();
          }
        }}
        aria-label="Co se v tu dobu bude dít"
        className={cn("flex-1", roomy ? "text-sm leading-5" : "text-[11px] leading-4")}
      />
      {onDelete ? (
        <DeleteButton
          roomy={roomy}
          label={draft.trim() || initial}
          onDelete={() => {
            settled.current = true;
            onDelete();
          }}
        />
      ) : null}
    </span>
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
