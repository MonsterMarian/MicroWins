"use client";

import * as React from "react";
import { tapFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

const HOLD = 420;
const SLOP = 10;

interface DragState {
  index: number;
  to: number;
  delta: number;
  size: number;
}

interface Session {
  id: string;
  index: number;
  to: number;
  pointerId: number;
  startPagePos: number;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  rows: { start: number; size: number }[];
  raf: number;
  dragging: boolean;
  hold: number;
  element: HTMLElement | null;
  detach: () => void;
}

interface SortableApi {
  ids: string[];
  drag: DragState | null;
  disabled: boolean;
  axis: "x" | "y";
  pressed: string | null;
  register: (id: string, el: HTMLElement | null) => void;
  press: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  swallowClick: React.RefObject<boolean>;
}

const SortableContext = React.createContext<SortableApi | null>(null);

const EDGE = 72;
const EDGE_SPEED = 14;

export function SortableList({
  ids,
  onReorder,
  onDropInto,
  isFolder,
  disabled = false,
  axis = "y",
  className,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  onDropInto?: (id: string, targetId: string) => void;
  isFolder?: (id: string) => boolean;
  disabled?: boolean;
  axis?: "x" | "y";
  className?: string;
  children: React.ReactNode;
}) {
  const nodes = React.useRef(new Map<string, HTMLElement>());
  const session = React.useRef<Session | null>(null);
  const swallowClick = React.useRef(false);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [pressed, setPressed] = React.useState<string | null>(null);

  const latest = React.useRef({ ids, onReorder, onDropInto, isFolder, axis });
  latest.current = { ids, onReorder, onDropInto, isFolder, axis };

  const register = React.useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const update = React.useCallback((clientX: number, clientY: number) => {
    const s = session.current;
    if (!s || !s.dragging) return;
    s.clientX = clientX;
    s.clientY = clientY;

    const isX = latest.current.axis === "x";
    const clientPos = isX ? clientX : clientY;
    const scrollPos = isX ? window.scrollX : window.scrollY;

    const delta = clientPos + scrollPos - s.startPagePos;
    const row = s.rows[s.index];
    const center = row.start + row.size / 2 + delta;

    let to = s.index;
    s.rows.forEach((other, i) => {
      if (i === s.index) return;
      const otherCenter = other.start + other.size / 2;
      if (i < s.index && center < otherCenter) to = Math.min(to, i);
      if (i > s.index && center > otherCenter) to = Math.max(to, i);
    });

    if (to !== s.to) void tapFeedback();
    s.to = to;
    setDrag((prev) => (prev && prev.delta === delta && prev.to === to ? prev : prev && { ...prev, delta, to }));
  }, []);

  const autoScroll = React.useCallback(() => {
    const s = session.current;
    if (!s || !s.dragging) return;
    const isX = latest.current.axis === "x";
    
    if (isX) {
      const above = EDGE - s.clientX;
      const below = s.clientX - (window.innerWidth - EDGE);
      const speed = above > 0 ? -EDGE_SPEED * Math.min(1, above / EDGE) : below > 0 ? EDGE_SPEED * Math.min(1, below / EDGE) : 0;
      if (speed !== 0) {
        window.scrollBy(speed, 0);
        update(s.clientX, s.clientY);
      }
    } else {
      const above = EDGE - s.clientY;
      const below = s.clientY - (window.innerHeight - EDGE);
      const speed = above > 0 ? -EDGE_SPEED * Math.min(1, above / EDGE) : below > 0 ? EDGE_SPEED * Math.min(1, below / EDGE) : 0;
      if (speed !== 0) {
        window.scrollBy(0, speed);
        update(s.clientX, s.clientY);
      }
    }
    s.raf = requestAnimationFrame(autoScroll);
  }, [update]);

  const engage = React.useCallback(() => {
    const s = session.current;
    if (!s || s.dragging) return;

    const rects = latest.current.ids.map((rowId) =>
      nodes.current.get(rowId)?.getBoundingClientRect(),
    );
    const index = latest.current.ids.indexOf(s.id);
    if (index < 0 || rects.some((r) => r === undefined)) {
      session.current = null;
      s.detach();
      setPressed(null);
      return;
    }

    const isX = latest.current.axis === "x";

    s.dragging = true;
    s.index = index;
    s.to = index;
    s.rows = rects.map((r) => ({ 
      start: (isX ? r!.left : r!.top) + (isX ? window.scrollX : window.scrollY), 
      size: isX ? r!.width : r!.height 
    }));
    s.startPagePos = (isX ? s.startClientX : s.startClientY) + (isX ? window.scrollX : window.scrollY);

    try {
      s.element?.setPointerCapture(s.pointerId);
    } catch {}

    void tapFeedback();
    setPressed(null);
    setDrag({ index, to: index, delta: 0, size: s.rows[index]!.size });
  }, []);

  const press = React.useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (disabled || session.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (latest.current.ids.indexOf(id) < 0) return;

      const pointerId = event.pointerId;
      const element = event.currentTarget;

      const onMove = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        if (s.dragging) {
          if (e.cancelable) e.preventDefault();
          update(e.clientX, e.clientY);
          return;
        }
        if (Math.hypot(e.clientX - s.startClientX, e.clientY - s.startClientY) > SLOP) cancel();
      };

      const onTouchMove = (e: TouchEvent) => {
        if (session.current?.dragging && e.cancelable) e.preventDefault();
      };

      const onEnd = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        const wasDragging = s.dragging;
        const { index, to } = s;
        cancel();
        if (!wasDragging) return;

        if (to === index) return;
        const next = [...latest.current.ids];
        const [moved] = next.splice(index, 1);
        next.splice(to, 0, moved);
        latest.current.onReorder(next);
      };

      const cancel = () => {
        const s = session.current;
        if (!s) return;
        session.current = null;
        window.clearTimeout(s.hold);
        cancelAnimationFrame(s.raf);
        s.detach();
        if (s.dragging) {
          swallowClick.current = true;
          window.setTimeout(() => {
            swallowClick.current = false;
          }, 400);
        }
        setPressed(null);
        setDrag(null);
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("touchmove", onTouchMove);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("touchmove", onTouchMove, { passive: false });

      session.current = {
        id,
        index: -1,
        to: -1,
        pointerId,
        startPagePos: 0,
        startClientX: event.clientX,
        startClientY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        rows: [],
        raf: 0,
        dragging: false,
        hold: window.setTimeout(() => {
          engage();
          const s = session.current;
          if (s?.dragging) s.raf = requestAnimationFrame(autoScroll);
        }, HOLD),
        element,
        detach,
      };

      setPressed(id);
    },
    [disabled, update, autoScroll, engage],
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

  const dragging = drag !== null;

  const api = React.useMemo<SortableApi>(
    () => ({ ids, drag, disabled, axis, pressed, register, press, swallowClick }),
    [ids, drag, disabled, axis, pressed, register, press],
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
  const { ids, drag, disabled, axis, pressed, register, press, swallowClick } = ctx;

  const index = ids.indexOf(id);
  const active = drag !== null && drag.index === index;
  const waiting = pressed === id;

  let shift = 0;
  if (drag && !active) {
    if (index > drag.index && index <= drag.to) shift = -drag.size;
    if (index < drag.index && index >= drag.to) shift = drag.size;
  }
  const offset = active ? drag.delta : shift;

  return (
    <div
      ref={(el) => register(id, el)}
      onPointerDown={disabled ? undefined : (e) => press(id, e)}
      onContextMenu={(e) => {
        if (!disabled) e.preventDefault();
      }}
      onDragStart={(e) => e.preventDefault()}
      draggable={false}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        transform: offset ? (axis === "x" ? `translateX(${offset}px)` : `translateY(${offset}px)`) : undefined,
        transition: active ? "none" : "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
      className={cn(
        "relative bg-card transition-all duration-200",
        active && "z-50 scale-[1.02] rounded-lg shadow-lg ring-1 ring-primary/30 bg-background",
        waiting && !active && "scale-[0.99]",
        (active || waiting) && "select-none [-webkit-touch-callout:none]",
        drag && !active && "z-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
