"use client";

import * as React from "react";
import { ArrowRight, Check, Clock, Link2, Minus, Plus, Trash2, Undo2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, formatDate } from "@/lib/date";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  blockEnd,
  blockTitle,
  DURATION_CHOICES,
  formatLength,
  formatMinutes,
  TIMEBLOCK_MAX_TITLE,
} from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Všechno, co jde s jedním blokem udělat, na jednom místě pod palcem.
 *
 * Dřív to bylo rozházené: text se přepisoval v políčku, délka nešla změnit
 * vůbec, přesun jen tahem a smazání malým křížkem (20 px), na který se dalo
 * ťuknout omylem. Panel se otevře ťuknutím na zápis nebo jeho podržením.
 * Změny platí hned, žádné Uložit - jen text se zapíše při odchodu z pole.
 */
export function BlockSheet({
  blockId,
  onClose,
  onReschedule,
}: {
  blockId: string | null;
  onClose: () => void;
  /** Jiný čas - panel „Kdy?“ pro tenhle blok. */
  onReschedule: (block: TimeBlock) => void;
}) {
  const { state } = useStore();
  const block = blockId ? (state.timeBlocks.find((b) => b.id === blockId) ?? null) : null;

  /* Blok mohl zmizet pod rukama (synchronizace, Vrátit v jiné hlášce) -
     prázdný panel by visel nad ničím. */
  React.useEffect(() => {
    if (blockId && !block) onClose();
  }, [blockId, block, onClose]);

  return (
    <BottomSheet
      open={block !== null}
      onClose={onClose}
      title={block ? blockTitle(state, block) || "Bez názvu" : ""}
      description={block ? `${formatDate(block.date)} · ${formatMinutes(block.start)}–${formatMinutes(blockEnd(block) % (24 * 60))}` : undefined}
    >
      {block ? (
        <BlockBody key={block.id} block={block} onClose={onClose} onReschedule={onReschedule} />
      ) : null}
    </BottomSheet>
  );
}

function linkLabel(block: TimeBlock): string | null {
  if (block.todoId) return "Z ToDo - text se mění tam";
  if (block.taskId) return "Úkol z projektu - text se mění u úkolu";
  if (block.priorityId) return "Hlavní věc dne - text se mění v trojce";
  return null;
}

function BlockBody({
  block,
  onClose,
  onReschedule,
}: {
  block: TimeBlock;
  onClose: () => void;
  onReschedule: (block: TimeBlock) => void;
}) {
  const { state, updateBlock, toggleBlockDone, deleteBlock, restoreBlock } = useStore();
  const { toast } = useToast();
  const linked = linkLabel(block);
  const done = block.doneAt !== null;
  const [draft, setDraft] = React.useState(block.title);
  const latest = React.useRef({ draft, block });
  latest.current = { draft, block };

  /** Text se zapíše při odchodu z pole i při zavření panelu. Prázdný se nebere -
      vygumovat zápis je tady Smazat, ne prázdný řádek. */
  const commitTitle = React.useCallback(() => {
    const { draft: text, block: current } = latest.current;
    const value = text.trim();
    if (value && value !== current.title) updateBlock(current.id, { title: value });
  }, [updateBlock]);

  React.useEffect(() => () => commitTitle(), [commitTitle]);

  const shift = (minutes: number) => {
    updateBlock(block.id, { start: block.start + minutes });
    void tapFeedback();
  };

  const toTomorrow = () => {
    commitTitle();
    const from = block.date;
    const to = addDays(block.date, 1);
    updateBlock(block.id, { date: to });
    void tapFeedback();
    onClose();
    toast({
      tone: "info",
      title: `Na zítra ${formatMinutes(block.start)}`,
      description: blockTitle(state, block),
      action: { label: "Vrátit", onClick: () => updateBlock(block.id, { date: from }) },
    });
  };

  const remove = () => {
    const removed = deleteBlock(block.id);
    onClose();
    if (!removed) return;
    void tapFeedback();
    toast({
      tone: "info",
      title: "Odebráno",
      description: `${formatMinutes(removed.start)} ${blockTitle(state, removed)}`,
      action: { label: "Vrátit", onClick: () => restoreBlock(removed) },
    });
  };

  const toggle = () => {
    commitTitle();
    void (done ? tapFeedback() : winFeedback());
    toggleBlockDone(block.id);
    // Odškrtnutím je s blokem hotovo, panel může jít pryč. Vrácení nechá
    // panel otevřený - člověk ho asi bude ještě přeplánovávat.
    if (!done) onClose();
  };

  return (
    <div className="flex flex-col gap-4 pb-1">
      {linked ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5 shrink-0" />
          {linked}
        </p>
      ) : (
        <input
          value={draft}
          maxLength={TIMEBLOCK_MAX_TITLE}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          aria-label="Co se v tu dobu bude dít"
          placeholder="Co se v tu dobu bude dít"
          className="h-12 rounded-xl border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Čas</span>
        <div className="flex items-center gap-2">
          <StepButton label="O půl hodiny dřív" onClick={() => shift(-30)} disabled={block.start < 30}>
            <Minus />
          </StepButton>
          <button
            type="button"
            onClick={() => {
              commitTitle();
              onReschedule(block);
            }}
            className="tabular flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border text-lg font-medium"
          >
            <Clock className="size-4 text-muted-foreground" />
            {formatMinutes(block.start)}–{formatMinutes(blockEnd(block) % (24 * 60))}
          </button>
          <StepButton
            label="O půl hodiny později"
            onClick={() => shift(30)}
            disabled={blockEnd(block) + 30 > 24 * 60}
          >
            <Plus />
          </StepButton>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Délka</span>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_CHOICES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={minutes === block.duration}
              onClick={() => {
                updateBlock(block.id, { duration: minutes });
                void tapFeedback();
              }}
              className={cn(
                "tabular h-10 rounded-full border px-3.5 text-sm transition-colors",
                minutes === block.duration
                  ? "border-progress bg-progress font-semibold text-progress-foreground"
                  : "hover:bg-accent",
              )}
            >
              {formatLength(minutes)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Action onClick={toggle} className={done ? "" : "border-progress"}>
          {done ? <Undo2 /> : <Check />}
          {done ? "Vrátit" : "Hotovo"}
        </Action>
        <Action onClick={toTomorrow}>
          <ArrowRight />
          Na zítra
        </Action>
        <Action onClick={remove} className="text-destructive">
          <Trash2 />
          Smazat
        </Action>
      </div>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-12 shrink-0 place-items-center rounded-xl border disabled:opacity-40 [&_svg]:size-5"
    >
      {children}
    </button>
  );
}

function Action({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors hover:bg-accent [&_svg]:size-5",
        className,
      )}
    >
      {children}
    </button>
  );
}
