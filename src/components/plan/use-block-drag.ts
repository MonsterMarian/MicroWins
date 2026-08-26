"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { tapFeedback } from "@/lib/native";
import { clampDuration, clampStart, MIN_DURATION, snapMinutes } from "@/lib/timeblocks";
import type { ISODate, TimeBlock } from "@/lib/types";

/**
 * Tahání bloků v plánu - společné pro osu dne i pro týden.
 *
 * Dvě pravidla, na kterých celé chování stojí:
 *
 * 1. **Posun se pozná až po podržení prstu** (`HOLD`). Mřížka je plná bloků
 *    a stránka se musí dát pořád normálně scrollovat; okamžitý tah by scroll
 *    sebral. Stejné pravidlo jako u přetahování v seznamech.
 * 2. **Za spodní hranu se blok chytá hned.** Úchyt je malý a nikdo si ho
 *    se scrolováním neplete, takže čekat na podržení by byl krok navíc.
 *
 * Během tahu se nic neukládá - drží se jen náhled (`drag`) a zapíše se až po
 * puštění. Průběžné ukládání by při každém škubnutí prstu přepsalo stav
 * a v týdnu s ním i termíny navázaných položek ToDo.
 */

/** Jak dlouho se drží prst, než se blok zvedne. */
const HOLD = 320;
/** Pohyb do téhle vzdálenosti je pořád ještě ťuknutí, ne tah. */
const SLOP = 10;
/** Od kraje obrazovky se při tahu samo popojíždí. */
const EDGE = 80;
const EDGE_SPEED = 12;

export interface BlockDrag {
  id: string;
  start: number;
  duration: number;
  date: ISODate;
}

interface Session {
  mode: "move" | "resize";
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  baseStart: number;
  baseDuration: number;
  baseDate: ISODate;
  hold: number;
  raf: number;
  active: boolean;
  detach: () => void;
}

export interface BlockDragApi {
  /** Náhled právě taženého bloku; `null` = nikdo se netahá. */
  drag: BlockDrag | null;
  /** Zavěsit na `onPointerDown` bloku (`move`) nebo jeho úchytu (`resize`). */
  begin: (mode: "move" | "resize", block: TimeBlock, event: React.PointerEvent<HTMLElement>) => void;
  /** true = právě doběhl tah, klepnutí po něm se má spolknout. */
  swallow: React.RefObject<boolean>;
}

export function useBlockDrag({
  pxPerMin,
  dayAt,
}: {
  pxPerMin: number;
  /** Týden: který den leží pod prstem. Osa dne den neřeší a nechává `undefined`. */
  dayAt?: (clientX: number) => ISODate | null;
}): BlockDragApi {
  const { updateBlock } = useStore();
  const [drag, setDrag] = React.useState<BlockDrag | null>(null);
  /* Náhled i mimo render: po puštění se z něj ukládá a React může updater
     zavolat dvakrát, takže číst ho ze `setDrag` by blok posunulo dvakrát. */
  const value = React.useRef<BlockDrag | null>(null);
  const session = React.useRef<Session | null>(null);
  const swallow = React.useRef(false);

  const latest = React.useRef({ pxPerMin, dayAt, updateBlock });
  latest.current = { pxPerMin, dayAt, updateBlock };

  const apply = React.useCallback((next: BlockDrag) => {
    const before = value.current;
    if (before && before.start === next.start && before.date === next.date && before.duration === next.duration) {
      return;
    }
    void tapFeedback();
    value.current = next;
    setDrag(next);
  }, []);

  const move = React.useCallback(
    (clientX: number, clientY: number) => {
      const s = session.current;
      if (!s || !s.active) return;
      const { pxPerMin: px, dayAt: at } = latest.current;
      const delta = (clientY - s.startY) / px;

      if (s.mode === "resize") {
        apply({
          id: s.id,
          date: s.baseDate,
          start: s.baseStart,
          duration: clampDuration(
            Math.max(MIN_DURATION, snapMinutes(s.baseDuration + delta)),
            s.baseStart,
          ),
        });
        return;
      }

      const start = clampStart(snapMinutes(s.baseStart + delta), s.baseDuration);
      apply({
        id: s.id,
        date: at?.(clientX) ?? s.baseDate,
        start,
        duration: s.baseDuration,
      });
    },
    [apply],
  );

  const autoScroll = React.useCallback(() => {
    const s = session.current;
    if (!s || !s.active) return;
    const above = EDGE - s.clientY;
    const below = s.clientY - (window.innerHeight - EDGE);
    const speed =
      above > 0
        ? -EDGE_SPEED * Math.min(1, above / EDGE)
        : below > 0
          ? EDGE_SPEED * Math.min(1, below / EDGE)
          : 0;
    if (speed !== 0) {
      // Stránka pod prstem ujíždí, takže se musí přepočítat i poloha bloku.
      window.scrollBy(0, speed);
      const s2 = session.current;
      if (s2) {
        s2.startY -= speed;
        move(s2.clientX, s2.clientY);
      }
    }
    if (session.current) session.current.raf = requestAnimationFrame(autoScroll);
  }, [move]);

  const begin = React.useCallback(
    (mode: "move" | "resize", block: TimeBlock, event: React.PointerEvent<HTMLElement>) => {
      if (session.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const pointerId = event.pointerId;

      const onMove = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        s.clientX = e.clientX;
        s.clientY = e.clientY;
        if (!s.active) {
          // Než se blok zvedne, patří pohyb prstu stránce - a tím pádem konec.
          if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > SLOP) end(false);
          return;
        }
        if (e.cancelable) e.preventDefault();
        move(e.clientX, e.clientY);
      };

      const onTouchMove = (e: TouchEvent) => {
        if (session.current?.active && e.cancelable) e.preventDefault();
      };

      const onUp = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        end(true);
      };

      const end = (commit: boolean) => {
        const s = session.current;
        if (!s) return;
        session.current = null;
        window.clearTimeout(s.hold);
        cancelAnimationFrame(s.raf);
        s.detach();

        const final = value.current;
        value.current = null;
        setDrag(null);
        if (!s.active) return;

        // Puštění po tahu nesmí otevřít editor - prst přece jen posouval.
        swallow.current = true;
        window.setTimeout(() => {
          swallow.current = false;
        }, 300);

        if (!commit || !final) return;
        const moved =
          final.start !== s.baseStart ||
          final.date !== s.baseDate ||
          final.duration !== s.baseDuration;
        if (moved) {
          latest.current.updateBlock(s.id, {
            start: final.start,
            duration: final.duration,
            date: final.date,
          });
        }
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("touchmove", onTouchMove);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });

      const start: Session = {
        mode,
        id: block.id,
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        baseStart: block.start,
        baseDuration: block.duration,
        baseDate: block.date,
        hold: 0,
        raf: 0,
        active: mode === "resize",
        detach,
      };
      session.current = start;

      const engage = () => {
        const s = session.current;
        if (!s) return;
        s.active = true;
        void tapFeedback();
        value.current = {
          id: s.id,
          start: s.baseStart,
          duration: s.baseDuration,
          date: s.baseDate,
        };
        setDrag(value.current);
        s.raf = requestAnimationFrame(autoScroll);
      };

      if (mode === "resize") {
        try {
          event.currentTarget.setPointerCapture(pointerId);
        } catch {
          // starší WebView - tah funguje i bez zachycení
        }
        engage();
      } else {
        start.hold = window.setTimeout(engage, HOLD);
      }
    },
    [autoScroll, move],
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

  return { drag, begin, swallow };
}
