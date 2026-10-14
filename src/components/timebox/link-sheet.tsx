"use client";

import * as React from "react";
import { Brain, CalendarClock, Link2, ListOrdered, Trash2, X } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback } from "@/lib/native";
import { formatMinutes } from "@/lib/timeblocks";
import { placesOf } from "@/lib/timebox";
import type { ISODate } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Odkud se panel otevřel - podle toho se jmenuje „odebrat odsud“. */
export type LinkOrigin = "dump" | "priority" | "block";

const HERE: Record<LinkOrigin, string> = {
  dump: "Jen z brain dumpu",
  priority: "Jen z hlavních věcí",
  block: "Jen z papíru",
};

/**
 * Kde všude věc v listu dne je - a jak ji smazat.
 *
 * Věc z dumpu se do papíru a trojky kopíruje (`lib/timebox.ts`, „jedna věc
 * na více místech“). Panel ji ukáže pohromadě a nabídne obě mazání vedle
 * sebe: jen odsud (ostatní místa zůstanou), nebo všude. Obojí jde vrátit.
 */
export function LinkSheet({
  date,
  text,
  origin,
  onClose,
  onRemoveHere,
}: {
  date: ISODate;
  /** Text věci; prázdný = panel zavřený. */
  text: string | null;
  origin: LinkOrigin;
  onClose: () => void;
  /** Smazání jen z místa, odkud se panel otevřel. */
  onRemoveHere: () => void;
}) {
  const { state, deleteEverywhere, restoreEverywhere } = useStore();
  const { toast } = useToast();
  const shown = React.useRef(text);
  if (text) shown.current = text;
  const title = text ?? shown.current ?? "";
  const places = placesOf(state, date, title);

  const removeEverywhere = () => {
    const removed = deleteEverywhere(date, title);
    onClose();
    if (!removed) return;
    void tapFeedback();
    toast({
      tone: "info",
      title: "Smazáno všude",
      description: title,
      action: { label: "Vrátit", onClick: () => restoreEverywhere(removed) },
    });
  };

  return (
    <BottomSheet open={text !== null && text !== ""} onClose={onClose} title={title} description="Tahle věc je na více místech listu.">
      <div className="flex flex-col gap-4 pb-1">
        <ul className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
          {places.dumpLines.length > 0 ? (
            <Place icon={Brain} label="Brain dump" />
          ) : null}
          {places.priority !== null ? (
            <Place icon={ListOrdered} label={`${places.priority + 1}. hlavní věc dne`} />
          ) : null}
          {places.blocks.map((block) => (
            <Place
              key={block.id}
              icon={CalendarClock}
              label={`Papír ${formatMinutes(block.start)}${block.doneAt ? " · hotovo" : ""}`}
            />
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-2">
          <Action
            onClick={() => {
              onRemoveHere();
              onClose();
            }}
          >
            <X />
            {HERE[origin]}
          </Action>
          <Action onClick={removeEverywhere} className="border-destructive/50 text-destructive">
            <Trash2 />
            Smazat všude
          </Action>
        </div>
      </div>
    </BottomSheet>
  );
}

function Place({ icon: Icon, label }: { icon: typeof Brain; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Link2 className="size-3.5 shrink-0 text-muted-foreground/60" />
    </li>
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
        "flex h-12 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors hover:bg-accent [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}
