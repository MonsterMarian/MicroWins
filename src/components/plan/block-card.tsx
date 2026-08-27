"use client";

import * as React from "react";
import { Check, GripHorizontal, Plus } from "lucide-react";
import { useStore } from "@/components/providers/store-provider";
import { tapFeedback } from "@/lib/native";
import { blockTitle, formatLength, formatMinutes, type DuePin } from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BlockDragApi } from "./use-block-drag";

/**
 * Blok v mřížce - stejný v ose dne i v týdnu, jen hustší.
 *
 * Odkud blok je, se pozná podle **barevného proužku vlevo**, ne podle barvy
 * celé karty: den plný barevných obdélníků je nečitelný, kdežto proužek se dá
 * přelétnout očima a zbytek karty zůstane klidný. Zelená (barva postupu) =
 * úkol z projektu, tmavá = položka ze seznamu, šedá = blok napsaný ručně.
 */

export type BlockTone = "task" | "todo" | "plain";

export function toneOf(block: TimeBlock): BlockTone {
  if (block.taskId) return "task";
  if (block.todoId) return "todo";
  return "plain";
}

export const RAIL: Record<BlockTone, string> = {
  task: "bg-progress",
  todo: "bg-blue-500",
  plain: "bg-muted-foreground/40",
};

export function BlockCard({
  block,
  top,
  height,
  left,
  width,
  dragging,
  compact,
  drag,
  onOpen,
}: {
  block: TimeBlock;
  top: number;
  height: number;
  /** Sloupec v procentech - v týdnu den, v ose dne překryv. */
  left: string;
  width: string;
  dragging: boolean;
  compact?: boolean;
  drag: BlockDragApi;
  onOpen: () => void;
}) {
  const { state, toggleBlockDone } = useStore();
  const title = blockTitle(state, block);
  const done = block.doneAt !== null;
  const tone = toneOf(block);

  /* Nízký blok unese jeden řádek textu a nic víc - čas ani zaškrtávátko se do
     něj nevejdou, aniž by z toho byla kaše. */
  const roomForTime = height >= (compact ? 46 : 40);
  const roomForCheck = height >= 34 && !compact;

  return (
    <div
      data-block
      onPointerDown={(e) => drag.begin("move", block, e)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (drag.swallow.current) return;
        onOpen();
      }}
      style={{ top, height, left, width }}
      className={cn(
        "absolute flex select-none overflow-hidden rounded-md border bg-card text-foreground [-webkit-touch-callout:none]",
        "transition-[box-shadow,opacity] duration-150",
        done ? "opacity-50" : "shadow-sm",
        dragging ? "z-30 shadow-lg ring-2 ring-foreground/25 opacity-90" : "z-10",
      )}
    >
      <div className={cn("w-1 shrink-0", RAIL[tone])} />

      <div className={cn("flex min-w-0 flex-1 flex-col justify-center", compact ? "px-1 py-0.5" : "px-2 py-1")}>
        <p
          className={cn(
            "truncate font-medium leading-tight",
            compact ? "text-[11px]" : "text-[13px]",
            done && "text-muted-foreground line-through",
          )}
        >
          {title}
        </p>
        {roomForTime ? (
          <p className="tabular truncate text-[11px] leading-tight text-muted-foreground">
            {formatMinutes(block.start)} – {formatLength(block.duration)}
          </p>
        ) : null}
      </div>

      {roomForCheck ? (
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
            "m-1.5 grid size-5 shrink-0 place-items-center self-start rounded-full border transition-colors",
            done
              ? "border-progress bg-progress text-progress-foreground"
              : "border-muted-foreground/40 text-transparent hover:border-foreground",
          )}
        >
          <Check className="size-3" />
        </button>
      ) : null}

      {/* Úchyt na spodní hraně. Reaguje hned, ale je malý - do scrolování se
          neplete a prstem se trefí. */}
      <span
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.begin("resize", block, e);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-hidden
        className="absolute inset-x-0 bottom-0 flex h-3.5 cursor-ns-resize touch-none items-end justify-center text-muted-foreground/0 transition-colors hover:text-muted-foreground/50"
      >
        <GripHorizontal className="size-3" />
      </span>
    </div>
  );
}

/**
 * Termín z ToDo, který ještě nemá blok. Čárkovaně a bez výplně: v mřížce má
 * být poznat, že tohle si čas teprve říká, ale nikdo ho zatím nezabral.
 * Ťuknutím se z něj stane obyčejný blok.
 */
export function PinCard({
  pin,
  top,
  height,
  left,
  width,
  compact,
  onPlan,
}: {
  pin: DuePin;
  top: number;
  height: number;
  left: string;
  width: string;
  compact?: boolean;
  onPlan: () => void;
}) {
  return (
    <button
      type="button"
      data-block
      onClick={onPlan}
      style={{ top, height, left, width }}
      title={`Naplánovat: ${pin.todo.text}`}
      className={cn(
        "absolute z-10 flex items-center gap-1.5 overflow-hidden rounded-lg border border-dashed bg-background/40 text-left transition-colors",
        "border-muted-foreground/40 hover:border-foreground hover:bg-accent/40",
        compact ? "px-1.5" : "px-2",
      )}
    >
      <Plus className="size-3 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-muted-foreground",
          compact ? "text-[11px]" : "text-[12px]",
        )}
      >
        {pin.todo.text}
      </span>
    </button>
  );
}
