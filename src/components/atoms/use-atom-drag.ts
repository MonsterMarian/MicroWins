"use client";

import { useHoldDrag, type HoldDrag } from "@/components/ui/use-hold-drag";

/**
 * Tažení kusů po mapě atomů: puštění na jiný uzel pod něj kus převěsí i s tím,
 * co pod ním visí. Uzly se hlásí atributem `data-atom-id`.
 *
 * Držení i hledání cíle pod prstem řeší `useHoldDrag`, stejně jako v time boxu -
 * myš táhne hned, prst po podržení. Plátno se navíc samo posouvá u kraje, takže
 * se dá kus odtáhnout i na uzel, který zrovna není vidět.
 */

export interface AtomDragSource {
  id: string;
  title: string;
}

export interface AtomDropTarget {
  id: string;
}

export type AtomDrag = HoldDrag<AtomDragSource, AtomDropTarget>;

function findTarget(x: number, y: number): AtomDropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const id = el?.closest<HTMLElement>("[data-atom-id]")?.dataset.atomId;
  return id ? { id } : null;
}

export function useAtomDrag(
  onDrop: (source: AtomDragSource, target: AtomDropTarget) => void,
  scroller: () => HTMLElement | null,
): AtomDrag {
  return useHoldDrag<AtomDragSource, AtomDropTarget>({ findTarget, onDrop, scroller });
}
