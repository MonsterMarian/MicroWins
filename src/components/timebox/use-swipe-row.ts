"use client";

import * as React from "react";
import { isHoldDragging } from "@/components/ui/use-hold-drag";
import { tickFeedback } from "@/lib/native";

/** Kolik pixelů do strany, než se pohyb bere jako švihnutí (a ne jako ťuknutí). */
const DECIDE = 12;
/** Kolikrát víc do strany než svisle - jinak je to rolování. */
const RATIO = 1.5;
/** Za tuhle hranicí puštění akci provede. */
export const SWIPE_THRESHOLD = 72;
const SOFT = 96;

/**
 * Švihnutí řádku do strany - doprava jedna akce, doleva druhá.
 *
 * Řádek s tímhle švihnutím má zároveň podržení pro tah, takže se obě gesta
 * dělí časem a směrem: prst, který se do 420 ms rozjede do strany, švihá
 * (tah se tím sám zruší, protože se prst pohnul dřív, než se podržel); prst,
 * který podrží, táhne a švihnutí si ho nevšimne. Svislý pohyb patří rolování -
 * řádek má `touch-action: pan-y`, takže si ho prohlížeč vezme sám a pošle
 * `pointercancel`.
 *
 * Jen dotyk. Myší se švihat nedá (stejně jako mezi sekcemi) - na počítači
 * tahem vybírá text a začíná přetahování.
 *
 * Řádek musí mít `data-no-swipe`, jinak by švihnutí zároveň přepnulo sekci
 * appky.
 */
export function useSwipeRow({
  enabled,
  onRight,
  onLeft,
}: {
  enabled: boolean;
  onRight: () => void;
  onLeft: () => void;
}) {
  const [offset, setOffset] = React.useState(0);
  const track = React.useRef<{
    id: number;
    x: number;
    y: number;
    mode: "undecided" | "swipe" | "dead";
    armed: -1 | 0 | 1;
  } | null>(null);
  const swallowClick = React.useRef(false);
  const latest = React.useRef({ onRight, onLeft });
  latest.current = { onRight, onLeft };

  const reset = () => {
    track.current = null;
    setOffset(0);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || e.pointerType === "mouse" || track.current) return;
      track.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: "undecided", armed: 0 };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const t = track.current;
      if (!t || t.id !== e.pointerId || t.mode === "dead") return;
      // Prst podržel a táhne - to je tah věci, ne švihnutí.
      if (isHoldDragging()) {
        reset();
        return;
      }
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (t.mode === "undecided") {
        if (Math.abs(dy) > DECIDE && Math.abs(dy) * RATIO > Math.abs(dx)) {
          t.mode = "dead";
          return;
        }
        if (Math.abs(dx) <= DECIDE || Math.abs(dx) < Math.abs(dy) * RATIO) return;
        t.mode = "swipe";
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // bez zachycení švihnutí funguje, jen při úniku prstu z řádku skončí
        }
      }
      const shown = soften(dx);
      setOffset(shown);
      const armed = shown >= SWIPE_THRESHOLD ? 1 : shown <= -SWIPE_THRESHOLD ? -1 : 0;
      if (armed !== t.armed) {
        t.armed = armed;
        if (armed !== 0) void tickFeedback();
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const t = track.current;
      if (!t || t.id !== e.pointerId) return;
      reset();
      if (t.mode !== "swipe") return;
      // Puštění po švihnutí není ťuknutí na text pod prstem.
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 350);
      if (t.armed === 1) latest.current.onRight();
      else if (t.armed === -1) latest.current.onLeft();
    },
    onPointerCancel: () => reset(),
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  return { offset, swiping: offset !== 0, handlers };
}

/** Za hranicí akce řádek ještě jde, ale tuze - je znát, že dál už nic není. */
function soften(dx: number): number {
  const size = Math.abs(dx);
  if (size <= SOFT) return dx;
  return Math.sign(dx) * Math.min(150, SOFT + (size - SOFT) * 0.3);
}
