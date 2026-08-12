"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { usePrefs } from "@/components/providers/use-prefs";
import type { DoneStyle } from "@/lib/prefs";
import { cn } from "@/lib/utils";

/**
 * Přepínač hotovo/nehotovo u úkolu s cílem 1.
 *
 * Pět podob, přepínají se v Nastavení. Všechny dělají totéž a mají stejný
 * zásah - liší se jen tím, jak nahlas to říkají. Volba je na uživateli,
 * protože u téhle jediné plochy v appce jde o vkus, ne o funkci.
 *
 * V režimu `preview` se místo tlačítek vykreslí `div`y. Náhled v Nastavení
 * sedí uvnitř tlačítka, kterým se volba vybírá, a tlačítko v tlačítku je
 * neplatné HTML - prohlížeč ho rozhodí ještě před hydratací.
 */
export function DoneButton({
  done,
  onToggle,
  style,
  preview,
  className,
}: {
  done: boolean;
  onToggle: () => void;
  /** Vynutí podobu bez ohledu na nastavení - používá náhled v Nastavení. */
  style?: DoneStyle;
  /** Jen kresba, nic nepřepíná. */
  preview?: boolean;
  className?: string;
}) {
  const prefs = usePrefs();
  const variant = style ?? prefs.doneStyle;

  /** Root prvek: tlačítko, nebo neinteraktivní obal v náhledu. */
  const Shell = ({
    children,
    className: shellClass,
  }: {
    children: React.ReactNode;
    className: string;
  }) =>
    preview ? (
      <div className={shellClass}>{children}</div>
    ) : (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? "Zrušit hotovo" : "Označit jako hotové"}
        className={shellClass}
      >
        {children}
      </button>
    );

  if (variant === "switch") {
    return (
      <Shell
        className={cn(
          "flex items-center justify-between gap-3 rounded-xl border px-4 py-4 transition-colors",
          done ? "border-progress/50 bg-progress-muted/30" : "hover:bg-accent/50",
          className,
        )}
      >
        <span className={cn("text-base font-medium", !done && "text-muted-foreground")}>
          {done ? "Hotovo" : "Nehotovo"}
        </span>
        <span
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors",
            done ? "bg-progress" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "absolute top-1 size-5 rounded-full bg-card shadow transition-[left] duration-200 ease-out",
              done ? "left-6" : "left-1",
            )}
          />
        </span>
      </Shell>
    );
  }

  if (variant === "stamp") {
    return (
      <Shell
        className={cn("flex flex-col items-center gap-3 rounded-xl py-4 transition-colors", className)}
      >
        <span
          className={cn(
            "grid size-20 place-items-center rounded-full border-4 transition-all duration-200",
            done
              ? "scale-100 border-progress bg-progress text-progress-foreground"
              : "scale-95 border-dashed border-muted-foreground/40 text-muted-foreground/40",
          )}
        >
          <Check className={cn("transition-all", done ? "size-10" : "size-8")} />
        </span>
        <span className={cn("text-sm font-medium", done ? "text-progress" : "text-muted-foreground")}>
          {done ? "Hotovo" : "Klepni, až to bude hotové"}
        </span>
      </Shell>
    );
  }

  if (variant === "bar") {
    return (
      <Shell className={cn("flex flex-col gap-2 rounded-xl py-2 text-left", className)}>
        <span className="flex items-baseline justify-between">
          <span className={cn("text-base font-medium", !done && "text-muted-foreground")}>
            {done ? "Hotovo" : "Nehotovo"}
          </span>
          <span
            className={cn(
              "tabular text-sm font-semibold",
              done ? "text-progress" : "text-muted-foreground",
            )}
          >
            {done ? "100 %" : "0 %"}
          </span>
        </span>
        <span className="relative h-3 w-full overflow-hidden rounded-full bg-track shadow-[inset_0_1px_2px_rgb(0_0_0/0.16)]">
          <span
            className={cn(
              "block h-full rounded-full bg-progress transition-[width] duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
              done ? "w-full" : "w-0",
            )}
          />
        </span>
      </Shell>
    );
  }

  if (variant === "segment") {
    /* Dvě poloviny, jezdec pod nimi. Jediná podoba, která říká oba stavy
       naráz - kdo neví, co ťuknutí udělá, tady to vidí dopředu. */
    const labels = [false, true];
    return (
      <div
        className={cn(
          "relative grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium",
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg transition-transform duration-200 ease-out",
            done ? "translate-x-[calc(100%+0.5rem)] bg-progress" : "translate-x-0 bg-card shadow-sm",
          )}
        />
        {labels.map((value) => {
          const inner = (
            <>{value ? "Hotovo" : "Nehotovo"}</>
          );
          const style = cn(
            "relative z-10 rounded-lg py-3 text-center transition-colors",
            done === value
              ? value
                ? "text-progress-foreground"
                : "text-foreground"
              : "text-muted-foreground",
          );
          return preview ? (
            <div key={String(value)} className={style}>
              {inner}
            </div>
          ) : (
            <button
              key={String(value)}
              type="button"
              onClick={() => value !== done && onToggle()}
              aria-pressed={done === value}
              className={style}
            >
              {inner}
            </button>
          );
        })}
      </div>
    );
  }

  // "card" - původní podoba: velká plocha se zaškrtávátkem.
  return (
    <Shell
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
    </Shell>
  );
}

/** Zmenšený náhled do Nastavení - nic nepřepíná, jen ukazuje. */
export function DoneButtonPreview({ style, done }: { style: DoneStyle; done: boolean }) {
  return (
    <div className="pointer-events-none scale-90 opacity-90">
      <DoneButton preview style={style} done={done} onToggle={() => {}} className="w-full" />
    </div>
  );
}
