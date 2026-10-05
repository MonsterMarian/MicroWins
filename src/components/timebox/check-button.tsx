"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { tapFeedback, winFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

/**
 * Zaškrtávátko listu dne - všude stejné: prázdný rámeček je „ještě ne",
 * vyplněný s fajfkou „hotovo". Dřív měly řádky ToDo a „Nestihl jsem" fajfku
 * v rámečku i u nehotové věci, takže se nedalo poznat, co je odškrtnuté.
 *
 * Velikost jen mění rámeček: `sm` je políčko mřížky, `md` široká mřížka,
 * `lg` řádky seznamů. Terč pro prst je vždycky větší než kresba (neviditelný
 * okraj kolem), protože 14 px rámeček se palcem netrefí.
 */
const BOX = {
  sm: "size-3.5 rounded-[3px]",
  md: "size-[1.125rem] rounded-[4px]",
  lg: "size-5 rounded-[5px]",
} as const;

const ICON = { sm: "size-2.5", md: "size-3", lg: "size-3.5" } as const;

export function CheckButton({
  done,
  label,
  onToggle,
  size = "lg",
  disabled = false,
  className,
  children,
}: {
  done: boolean;
  /** Co se odškrtává - do popisku pro čtečku. */
  label: string;
  onToggle: () => void;
  size?: keyof typeof BOX;
  disabled?: boolean;
  className?: string;
  /** Co stojí v prázdném rámečku (pořadí hlavní věci); jinak nic. */
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void (done ? tapFeedback() : winFeedback());
        onToggle();
      }}
      disabled={disabled}
      aria-pressed={done}
      aria-label={done ? `Vrátit zpět: ${label}` : `Hotovo: ${label}`}
      className={cn(
        "relative grid shrink-0 place-items-center border transition-colors",
        "before:absolute before:-inset-1.5 before:content-['']",
        BOX[size],
        done
          ? "border-progress bg-progress text-progress-foreground"
          : "border-muted-foreground/40 text-muted-foreground",
        !done && !disabled && "hover:border-foreground/60",
        className,
      )}
    >
      {done ? <Check className={ICON[size]} /> : children}
    </button>
  );
}
