"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useAnimatedNumber, usePrefersReducedMotion, useValueChange } from "@/lib/motion";

export type ProgressTone = "progress" | "win" | "muted" | "destructive";

const FILL: Record<ProgressTone, string> = {
  progress: "bg-progress",
  win: "bg-win",
  muted: "bg-muted-foreground/60",
  destructive: "bg-destructive",
};

/**
 * Pruh postupu. Šířka nepřeskakuje - dojíždí s lehkým přehoupnutím, jako by
 * hodnota měla setrvačnost. Když povyroste, přeběhne přes vyplněnou část
 * světlo; dojezd do stovky navíc jednou zazáří.
 */
export function ProgressBar({
  value,
  className,
  tone = "progress",
  size = "md",
  quiet,
}: {
  /** 0-100 */
  value: number;
  className?: string;
  tone?: ProgressTone;
  size?: "sm" | "md" | "lg" | "xl";
  /** Vypne lesk i záblesk - pro místa, kde by jich naráz běželo deset. */
  quiet?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const change = useValueChange(pct);
  const reduced = usePrefersReducedMotion();
  const grew = !quiet && change !== null && change.delta > 0;
  const full = pct >= 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-track",
        "shadow-[inset_0_1px_2px_rgb(0_0_0/0.16)]",
        /* Tenké schválně: pruh je vedlejší údaj vedle procenta, tlusté pruhy
           v seznamu přebíjely názvy. Šířka zůstává, mění se jen výška. */
        size === "sm" ? "h-1" : size === "lg" ? "h-2" : size === "xl" ? "h-2.5" : "h-1.5",
        className,
      )}
    >
      <div
        className={cn(
          "relative h-full rounded-full",
          !reduced && "transition-[width] duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
          FILL[tone],
          grew && full && "mw-flash",
        )}
        style={{ width: `${pct}%` }}
      >
        {grew ? (
          /* `key` pouští animaci znovu i při dvou přírůstcích těsně za sebou. */
          <span key={change.nonce} className="mw-shine pointer-events-none absolute inset-0" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Procento, které se k nové hodnotě dopočítá a při přírůstku nadskočí.
 * `format` si volá volající - jinde se zobrazují celá čísla, jinde desetiny.
 */
export function AnimatedPercent({
  value,
  format,
  className,
  suffix = " %",
}: {
  value: number;
  format: (n: number) => string | number;
  className?: string;
  suffix?: string;
}) {
  const shown = useAnimatedNumber(value);
  const change = useValueChange(value);

  return (
    <span
      key={change?.delta && change.delta > 0 ? change.nonce : undefined}
      className={cn("tabular inline-block", change && change.delta > 0 && "mw-pop", className)}
    >
      {format(shown)}
      {suffix}
    </span>
  );
}

/**
 * Bublina "+5 %", která nad hodnotou vyplave a zmizí. Sama o sobě nic
 * nepozicuje - patří do rodiče s `relative`.
 */
export function DeltaBubble({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const change = useValueChange(value);
  if (!change) return null;

  const up = change.delta > 0;

  return (
    <span
      key={change.nonce}
      aria-hidden
      className={cn(
        "mw-rise pointer-events-none absolute left-1/2 top-0 z-10 rounded-full px-2 py-0.5",
        "tabular text-xs font-semibold shadow-sm",
        up
          ? "bg-progress text-progress-foreground"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {up ? "+" : "−"}
      {format(Math.abs(change.delta))}
    </span>
  );
}

/**
 * Posuvník hodnoty úkolu. Stopu kreslí obal, jezdec je nativní - jen
 * přestylovaný v `globals.css`, aby za něj šlo chytit prstem.
 */
export function Slider({
  value,
  max,
  step = 1,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const reduced = usePrefersReducedMotion();
  const change = useValueChange(pct);
  const grew = change !== null && change.delta > 0;

  return (
    <div className={cn("relative flex h-8 w-full items-center", className)}>
      <div className="absolute inset-x-0 h-2 overflow-hidden rounded-full bg-track shadow-[inset_0_1px_2px_rgb(0_0_0/0.16)]">
        <div
          className={cn(
            "relative h-full rounded-full bg-progress",
            /* Kratší dojezd než u pruhu: za jezdcem se prst musí táhnout hned,
               pružné přehoupnutí by při tažení působilo jako zpoždění. */
            !reduced && "transition-[width] duration-300 ease-out",
            grew && pct >= 100 && "mw-flash",
          )}
          style={{ width: `${pct}%` }}
        >
          {grew ? (
            <span key={change.nonce} className="mw-shine pointer-events-none absolute inset-0" />
          ) : null}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-input relative z-10 h-8 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
