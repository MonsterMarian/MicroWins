import * as React from "react";
import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  className,
  tone = "progress",
  size = "md",
}: {
  /** 0-100 */
  value: number;
  className?: string;
  tone?: "progress" | "win" | "muted";
  size?: "sm" | "md" | "lg";
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "w-full overflow-hidden rounded-full bg-track",
        size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          tone === "win" ? "bg-win" : tone === "muted" ? "bg-muted-foreground/60" : "bg-progress",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

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
  return (
    <div className={cn("relative flex h-6 w-full items-center", className)}>
      <div className="absolute inset-x-0 h-2.5 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
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
        className="slider-input relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
