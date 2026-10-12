"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useBackClose } from "./back-stack";

/** Kolik pixelů stažení dolů panel zavře. */
const CLOSE_DRAG = 90;

/**
 * Panel, který vyjede odspodu - na telefonu tam, kam dosáhne palec.
 *
 * Dialog uprostřed obrazovky je pro potvrzení a formuláře; tohle je pro rychlé
 * volby nad rozdělanou věcí (kdy, jak dlouho, hotovo). Zavírá se ťuknutím
 * vedle, stažením za horní pruh dolů, Escape i tlačítkem Zpět.
 *
 * Nic se samo nefokusuje: na telefonu by fokus v poli vysunul klávesnici
 * přes půl panelu, i když se jen vybírá čas. Kdo pole chce, dá mu `autoFocus`.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [pull, setPull] = React.useState(0);
  const pullStart = React.useRef<{ id: number; y: number } | null>(null);

  React.useEffect(() => setMounted(true), []);
  useBackClose(open, onClose);

  React.useEffect(() => {
    if (!open) return;
    setPull(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  /* Stažení za horní pruh. Jde jen dolů - nahoru panel nemá kam. */
  const grip = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      pullStart.current = { id: e.pointerId, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const start = pullStart.current;
      if (!start || start.id !== e.pointerId) return;
      setPull(Math.max(0, e.clientY - start.y));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const start = pullStart.current;
      pullStart.current = null;
      if (!start || start.id !== e.pointerId) return;
      if (e.clientY - start.y > CLOSE_DRAG) onClose();
      else setPull(0);
    },
    onPointerCancel: () => {
      pullStart.current = null;
      setPull(0);
    },
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      {/* Vyjetí a stažení jsou dvě vrstvy: animace s `fill-mode: both` by
          přebila posun prstem, kdyby seděly na jednom prvku. */}
      <div className="mw-sheet-in relative z-10 w-full max-w-md sm:mb-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === "string" ? title : undefined}
          className={cn(
            "flex max-h-[88dvh] w-full flex-col rounded-t-2xl border-t bg-card shadow-2xl sm:rounded-2xl sm:border",
            className,
          )}
          style={{
            transform: pull > 0 ? `translateY(${pull}px)` : undefined,
            transition: pullStart.current ? "none" : "transform 0.18s ease-out",
          }}
        >
          <div {...grip} className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-2.5">
            <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <h2 className="text-base font-semibold leading-snug tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+var(--mw-safe-bottom))] pt-1">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
