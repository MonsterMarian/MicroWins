"use client";

import { useHoldDrag, type HoldDrag } from "@/components/ui/use-hold-drag";
import type { CarryoverItem } from "@/lib/timebox";
import type { ISODate } from "@/lib/types";

/**
 * Co se po listu dne přetahuje a kam se to dá pustit.
 *
 * Samotné držení a hledání cíle pod prstem řeší `useHoldDrag`; tady se jen
 * pojmenují místa listu. Políčka mřížky se hlásí atributem `data-slot`,
 * hlavní věci dne `data-priority-index`, koš `data-trash`.
 */

export type DragSource =
  /** Zápis z mřížky - ten se **přesouvá**. */
  | { kind: "block"; id: string; title: string }
  /** Hlavní věc dne - ta se do mřížky **kopíruje i s odkazem** a zůstává nahoře. */
  | { kind: "priority"; index: number; date: ISODate; title: string }
  /** Rozdělaná práce z pásu nad listem - položka ToDo nebo úkol projektu. */
  | { kind: "queue"; title: string; todoId?: string; taskId?: string }
  /** Řádek brain dumpu; po puštění mimo dump řádek z dumpu zmizí. */
  | { kind: "dump"; rowId: number; title: string; label: string }
  /** Nedokončená věc z dřívějšího dne (sekce „Nestihl jsem“). */
  | { kind: "carryover"; item: CarryoverItem; title: string };

export type DropTarget =
  | { kind: "slot"; date: ISODate; start: number }
  | { kind: "priority"; index: number }
  /** Pruh, který se ukáže jen při tažení - puštění tam věc z listu sundá. */
  | { kind: "trash" };

export type TimeboxDrag = HoldDrag<DragSource, DropTarget>;

function findTarget(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;

  // Koš je nade vším ostatním, takže se hledá první.
  if (el.closest("[data-trash]")) return { kind: "trash" };

  const slot = el.closest<HTMLElement>("[data-slot]");
  if (slot) {
    const start = Number(slot.dataset.slotStart);
    const date = slot.dataset.slotDate;
    if (date && Number.isFinite(start)) return { kind: "slot", date, start };
  }

  const priority = el.closest<HTMLElement>("[data-priority-index]");
  if (priority) {
    const index = Number(priority.dataset.priorityIndex);
    if (Number.isInteger(index)) return { kind: "priority", index };
  }
  return null;
}

export function useTimeboxDrag(
  onDrop: (source: DragSource, target: DropTarget) => void,
): TimeboxDrag {
  return useHoldDrag<DragSource, DropTarget>({ findTarget, onDrop });
}
