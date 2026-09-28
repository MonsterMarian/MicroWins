"use client";

import * as React from "react";
import { tapFeedback } from "@/lib/native";

/**
 * Tažení věci na místo - „vezmi tohle a pusť to tam".
 *
 * Společný podklad pro přetahování, které **nemíchá pořadí v seznamu**, ale
 * hledá cíl pod prstem: políčko mřížky time boxu, hlavní věc dne, uzel mapy
 * atomů. Seznamy na to mají `SortableList`, tady se cíl hledá tím, nad čím prst
 * zrovna visí (`document.elementFromPoint`), ne přepočtem souřadnic - řádky
 * i uzly mají různou výšku a plátno atomů je navíc zvětšené, takže žádný pevný
 * přepočet by neseděl.
 *
 * Dvě věci, které drží po celé appce stejně:
 *
 * 1. **Myš táhne hned po prvním pohybu, prst až po podržení.** Prstem se
 *    stránka scrolluje tahem, takže okamžitý tah by ji zasekl - myší se
 *    nescrolluje nic a čekání by znamenalo jen to, že „přetahování nefunguje".
 * 2. **Puštění po tahu není klepnutí.** Jinak by se hned otevřelo pole
 *    a přepisovalo by se to, co se jen přesunulo.
 */

export interface HoldDragGhost<S> {
  source: S;
  /** Kde visí prst - popisek se kreslí `fixed` vedle něj. */
  x: number;
  y: number;
}

export interface HoldDrag<S, T> {
  press: (source: S, event: React.PointerEvent<HTMLElement>) => void;
  ghost: HoldDragGhost<S> | null;
  target: T | null;
}

/** Stejné držení jako u přetahování v seznamech. */
const HOLD = 420;
const SLOP = 10;
const EDGE = 72;
const EDGE_SPEED = 12;

interface Session<S> {
  source: S;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  hold: number;
  raf: number;
  dragging: boolean;
  detach: () => void;
}

export function useHoldDrag<S, T>({
  findTarget,
  onDrop,
  scroller,
}: {
  findTarget: (x: number, y: number) => T | null;
  onDrop: (source: S, target: T) => void;
  /**
   * Plocha, která se má u kraje sama posouvat, když má vlastní scrollování
   * (plátno atomů). Bez ní se posouvá okno.
   */
  scroller?: () => HTMLElement | null;
}): HoldDrag<S, T> {
  const session = React.useRef<Session<S> | null>(null);
  const [ghost, setGhost] = React.useState<HoldDragGhost<S> | null>(null);
  const [target, setTarget] = React.useState<T | null>(null);

  const latest = React.useRef({ findTarget, onDrop, scroller });
  latest.current = { findTarget, onDrop, scroller };

  /* Cíl se přepisuje jen při skutečné změně: pod prstem se hledá při každém
     pohybu, ale políčko bývá pořád to samé a nový objekt by překresloval celou
     mřížku desetkrát za sekundu. */
  const aim = React.useCallback((x: number, y: number) => {
    const next = latest.current.findTarget(x, y);
    setTarget((prev) => (sameTarget(prev, next) ? prev : next));
  }, []);

  const press = React.useCallback(
    (source: S, event: React.PointerEvent<HTMLElement>) => {
      if (session.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const element = event.currentTarget;
      const pointerId = event.pointerId;

      const onMove = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        if (!s.dragging) {
          if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) <= SLOP) return;
          if (e.pointerType === "mouse") {
            s.x = e.clientX;
            s.y = e.clientY;
            engage();
          } else {
            cancel(false);
          }
          return;
        }
        if (e.cancelable) e.preventDefault();
        s.x = e.clientX;
        s.y = e.clientY;
        setGhost({ source: s.source, x: s.x, y: s.y });
        aim(s.x, s.y);
      };

      const onTouchMove = (e: TouchEvent) => {
        if (session.current?.dragging && e.cancelable) e.preventDefault();
      };

      const onEnd = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        const dropped = s.dragging ? latest.current.findTarget(e.clientX, e.clientY) : null;
        const dragged = s.source;
        cancel(s.dragging);
        if (dropped !== null) latest.current.onDrop(dragged, dropped);
      };

      const cancel = (wasDragging: boolean) => {
        const s = session.current;
        if (!s) return;
        session.current = null;
        window.clearTimeout(s.hold);
        cancelAnimationFrame(s.raf);
        s.detach();
        setGhost(null);
        setTarget(null);
        if (wasDragging) {
          const swallow = (ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
          };
          window.addEventListener("click", swallow, { capture: true, once: true });
          window.setTimeout(
            () => window.removeEventListener("click", swallow, { capture: true }),
            350,
          );
        }
      };

      /**
       * Posouvání u kraje. Vlastní plocha se posouvá do obou stran (mapa atomů
       * bývá širší i vyšší než okénko), okno jen nahoru a dolů.
       */
      const scroll = () => {
        const s = session.current;
        if (!s || !s.dragging) return;
        const box = latest.current.scroller?.();
        const rect = box?.getBoundingClientRect();

        if (box && rect && s.x >= rect.left && s.x <= rect.right && s.y >= rect.top && s.y <= rect.bottom) {
          const dx = edgeSpeed(s.x - rect.left, rect.right - s.x);
          const dy = edgeSpeed(s.y - rect.top, rect.bottom - s.y);
          if (dx !== 0 || dy !== 0) {
            box.scrollBy(dx, dy);
            aim(s.x, s.y);
          }
        } else {
          const dy = edgeSpeed(s.y, window.innerHeight - s.y);
          if (dy !== 0) {
            window.scrollBy(0, dy);
            aim(s.x, s.y);
          }
        }
        s.raf = requestAnimationFrame(scroll);
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("touchmove", onTouchMove);
      };

      const engage = () => {
        const s = session.current;
        if (!s || s.dragging) return;
        window.clearTimeout(s.hold);
        s.dragging = true;
        try {
          element.setPointerCapture(pointerId);
        } catch {
          // starší WebView - tah funguje i bez zachycení
        }
        void tapFeedback();
        setGhost({ source: s.source, x: s.x, y: s.y });
        aim(s.x, s.y);
        s.raf = requestAnimationFrame(scroll);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("touchmove", onTouchMove, { passive: false });

      session.current = {
        source,
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        raf: 0,
        dragging: false,
        detach,
        hold: window.setTimeout(engage, HOLD),
      };
    },
    [aim],
  );

  React.useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      window.clearTimeout(s.hold);
      cancelAnimationFrame(s.raf);
      s.detach();
    },
    [],
  );

  return { press, ghost, target };
}

/** Jak rychle se posouvat, když je prst blízko kraje - čím blíž, tím rychleji. */
function edgeSpeed(fromStart: number, fromEnd: number): number {
  if (fromStart < EDGE) return -EDGE_SPEED * Math.min(1, (EDGE - fromStart) / EDGE);
  if (fromEnd < EDGE) return EDGE_SPEED * Math.min(1, (EDGE - fromEnd) / EDGE);
  return 0;
}

/** Cíle jsou ploché popisky místa (`{kind, date, start}`), stačí porovnat pole. */
function sameTarget(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((k) => left[k] === right[k]);
}
