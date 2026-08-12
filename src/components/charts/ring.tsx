import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Prstenec pro jedno číslo (postup, dny, hotové úkoly).
 * Jedna barva, recesivní stopa, zaoblený konec - žádná duha.
 */
export function Ring({
  value,
  label,
  children,
  size = 104,
  stroke = 9,
  tone = "progress",
  className,
}: {
  /** 0-100 */
  value: number;
  label?: string;
  children?: React.ReactNode;
  /** Největší průměr v pixelech; v užším sloupci se kolečko zmenší samo. */
  size?: number;
  stroke?: number;
  tone?: "progress" | "win";
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-2", className)}>
      {/* Šířka se řídí sloupcem, `size` je jen strop. SVG se doškáluje samo
          přes viewBox, takže tři kolečka vedle sebe se na telefonu vejdou
          a nemusí se zalamovat do druhé řady. */}
      <div className="relative w-full" style={{ maxWidth: size, aspectRatio: "1 / 1" }}>
        <svg className="block h-full w-full" viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--track)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone === "win" ? "var(--win)" : "var(--progress)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray 400ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
      </div>
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
    </div>
  );
}
