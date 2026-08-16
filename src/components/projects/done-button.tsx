"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Přepínač hotovo/nehotovo u úkolu s cílem 1.
 *
 * Podoba je jedna. Chvíli jich bylo pět, přepínaly se v Nastavení a všechny
 * dělaly totéž - lišily se jen tím, jak nahlas to říkají. Volba, u které
 * nezáleží na tom, jak dopadne, je jen další obrazovka k projití.
 */
export function DoneButton({
  done,
  onToggle,
  className,
}: {
  done: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      aria-label={done ? "Zrušit hotovo" : "Označit jako hotové"}
      className={cn(
        "flex items-center justify-center gap-3 rounded-xl border-2 px-4 py-6 text-base font-medium transition-colors",
        done
          ? "border-progress bg-progress-muted/40 text-progress"
          : "border-dashed text-muted-foreground hover:border-progress/50 hover:text-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-md border",
          done ? "border-progress bg-progress text-progress-foreground" : "border-border",
        )}
      >
        {done ? <Check className="size-5" /> : null}
      </span>
      {done ? "Hotovo" : "Označit jako hotové"}
    </button>
  );
}
