"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";
import { tapFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

/**
 * Přetahování řádků do vlastního pořadí.
 *
 * Postavené na Pointer Events, ne na HTML5 drag & drop - ten na Androidu
 * v prstu nefunguje vůbec. Chytá se za úchyt vlevo: kdyby se dal táhnout celý
 * řádek, nešlo by ho rozkliknout ani odškrtnout.
 *
 * Během tažení se nic neukládá. Ostatní řádky se jen posunou transformem,
 * takže se nepřepočítávají procenta ani se nesahá na stav - nové pořadí se
 * pošle až po puštění, jedním voláním `onReorder`.
 */

interface DragState {
  /** Index taženého řádku v původním pořadí. */
  index: number;
  /** Kam by řádek spadl, kdyby se teď pustil. */
  to: number;
  /** Posun prstu od začátku tažení (v pixelech stránky, ne okna). */
  dy: number;
  height: number;
}

interface Session {
  index: number;
  to: number;
  pointerId: number;
  /** Začátek tažení v souřadnicích stránky - okno se během tažení posouvá. */
  startPageY: number;
  clientY: number;
  rows: { top: number; height: number }[];
  raf: number;
  /** Odvěšení posluchačů okna - drží se u sezení, ať se nezapomene. */
  detach: () => void;
}

interface SortableApi {
  ids: string[];
  drag: DragState | null;
  disabled: boolean;
  register: (id: string, el: HTMLElement | null) => void;
  start: (id: string, event: React.PointerEvent<HTMLElement>) => void;
}

const SortableContext = React.createContext<SortableApi | null>(null);

/** Jak blízko k okraji okna se seznam začne sám odjíždět. */
const EDGE = 72;
const EDGE_SPEED = 14;

export function SortableList({
  ids,
  onReorder,
  disabled = false,
  className,
  children,
}: {
  /** Id viditelných řádků shora dolů - musí sedět na pořadí `children`. */
  ids: string[];
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const nodes = React.useRef(new Map<string, HTMLElement>());
  const session = React.useRef<Session | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);

  // Posluchače tažení visí na okně a nesmí se přepínat při každém pohybu -
  // aktuální seznam a callback si proto berou z refu.
  const latest = React.useRef({ ids, onReorder });
  latest.current = { ids, onReorder };

  const register = React.useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const update = React.useCallback((clientY: number) => {
    const s = session.current;
    if (!s) return;
    s.clientY = clientY;

    const dy = clientY + window.scrollY - s.startPageY;
    const row = s.rows[s.index];
    const center = row.top + row.height / 2 + dy;

    let to = s.index;
    s.rows.forEach((other, i) => {
      if (i === s.index) return;
      const otherCenter = other.top + other.height / 2;
      if (i < s.index && center < otherCenter) to = Math.min(to, i);
      if (i > s.index && center > otherCenter) to = Math.max(to, i);
    });

    if (to !== s.to) void tapFeedback();
    s.to = to;
    setDrag((prev) => (prev && prev.dy === dy && prev.to === to ? prev : prev && { ...prev, dy, to }));
  }, []);

  /** Dlouhý seznam se nedá projet prstem - u kraje okna se odjíždí sám. */
  const autoScroll = React.useCallback(() => {
    const s = session.current;
    if (!s) return;
    const above = EDGE - s.clientY;
    const below = s.clientY - (window.innerHeight - EDGE);
    const speed =
      above > 0
        ? -EDGE_SPEED * Math.min(1, above / EDGE)
        : below > 0
          ? EDGE_SPEED * Math.min(1, below / EDGE)
          : 0;
    if (speed !== 0) {
      window.scrollBy(0, speed);
      update(s.clientY);
    }
    s.raf = requestAnimationFrame(autoScroll);
  }, [update]);

  /**
   * Posluchače se věší hned tady, ne až v efektu po překreslení. Puštění
   * prstu hned po stisku by do té doby přišlo naprázdno a řádek by zůstal
   * viset v taženém stavu.
   */
  const start = React.useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (disabled || session.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const index = latest.current.ids.indexOf(id);
      if (index < 0) return;
      const rects = latest.current.ids.map((rowId) =>
        nodes.current.get(rowId)?.getBoundingClientRect(),
      );
      if (rects.some((r) => r === undefined)) return;

      event.preventDefault();
      try {
        // Prst může zmizet dřív, než se sem kód dostane - pak zachytávat není co.
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // tažení pojede i bez toho, události se chytají na okně
      }
      void tapFeedback();

      const onMove = (e: PointerEvent) => {
        if (session.current?.pointerId !== e.pointerId) return;
        if (e.cancelable) e.preventDefault();
        update(e.clientY);
      };

      const onEnd = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        session.current = null;
        s.detach();
        cancelAnimationFrame(s.raf);
        setDrag(null);
        if (s.to === s.index) return;

        const next = [...latest.current.ids];
        const [moved] = next.splice(s.index, 1);
        next.splice(s.to, 0, moved);
        latest.current.onReorder(next);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);

      session.current = {
        index,
        to: index,
        pointerId: event.pointerId,
        startPageY: event.clientY + window.scrollY,
        clientY: event.clientY,
        rows: rects.map((r) => ({ top: r!.top + window.scrollY, height: r!.height })),
        raf: 0,
        detach: () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onEnd);
          window.removeEventListener("pointercancel", onEnd);
        },
      };
      session.current.raf = requestAnimationFrame(autoScroll);
      setDrag({ index, to: index, dy: 0, height: rects[index]!.height });
    },
    [disabled, update, autoScroll],
  );

  // Odchod ze stránky uprostřed tažení nesmí nechat viset posluchače okna.
  React.useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      s.detach();
      cancelAnimationFrame(s.raf);
    },
    [],
  );

  const dragging = drag !== null;

  const api = React.useMemo<SortableApi>(
    () => ({ ids, drag, disabled, register, start }),
    [ids, drag, disabled, register, start],
  );

  return (
    <SortableContext.Provider value={api}>
      <div className={cn(dragging && "select-none", className)}>{children}</div>
    </SortableContext.Provider>
  );
}

export function SortableItem({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(SortableContext);
  if (!ctx) throw new Error("SortableItem musí být uvnitř SortableList");
  const { ids, drag, disabled, register, start } = ctx;

  const index = ids.indexOf(id);
  const active = drag !== null && drag.index === index;

  let shift = 0;
  if (drag && !active) {
    if (index > drag.index && index <= drag.to) shift = -drag.height;
    if (index < drag.index && index >= drag.to) shift = drag.height;
  }
  const offset = active ? drag.dy : shift;

  return (
    <div
      ref={(el) => register(id, el)}
      style={{
        transform: offset ? `translateY(${offset}px)` : undefined,
        // Tažený řádek musí jít přesně pod prstem, ostatní se doklouzají.
        transition: active ? "none" : "transform 0.16s ease",
      }}
      className={cn(
        "relative flex items-stretch bg-card",
        active && "z-20 rounded-lg shadow-lg ring-1 ring-border",
        drag && !active && "z-0",
        className,
      )}
    >
      {disabled ? null : (
        <button
          type="button"
          aria-label="Přetáhnout"
          onPointerDown={(e) => start(id, e)}
          className={cn(
            // touch-action: none, jinak by prst místo tažení scroloval stránku
            "drag-handle flex w-7 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50",
            "hover:text-foreground active:cursor-grabbing",
            active && "text-foreground",
          )}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
