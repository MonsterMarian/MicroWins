"use client";

import * as React from "react";
import { formatDate } from "@/lib/date";
import type { SeriesPoint } from "@/lib/projects";
import { cn, formatTenth } from "@/lib/utils";

/**
 * Vývoj postupu v čase - jedna řada, takže bez legendy (název grafu ji nese).
 * Osa je jedna, mřížka recesivní, na hover je nitkový kříž s hodnotou.
 */
export function ProgressAreaChart({
  points,
  height = 220,
  className,
}: {
  points: SeriesPoint[];
  height?: number;
  className?: string;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(640);
  const [hover, setHover] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padding = { top: 12, right: 12, bottom: 26, left: 34 };
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);

  const xOf = (i: number) =>
    padding.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yOf = (p: number) => padding.top + innerH - (Math.min(100, Math.max(0, p)) / 100) * innerH;

  if (points.length === 0) {
    return (
      <div ref={wrapRef} className={cn("grid h-40 place-items-center text-sm text-muted-foreground", className)}>
        Zatím není co vykreslit.
      </div>
    );
  }

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.percent)}`).join(" ");
  const area = `${line} L${xOf(points.length - 1)},${padding.top + innerH} L${xOf(0)},${
    padding.top + innerH
  } Z`;

  // Popisky osy X: nanejvýš 4, aby se nepřekrývaly.
  const tickCount = Math.min(4, points.length);
  const xTicks = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i / (tickCount - 1)) * (points.length - 1)),
  );

  const hovered = hover !== null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padding.left;
    const ratio = innerW > 0 ? x / innerW : 0;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, index)));
  };

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Vývoj postupu projektu v procentech"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={yOf(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {v}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="mw-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--progress)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--progress)" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#mw-area)" />
        <path
          d={line}
          fill="none"
          stroke="var(--progress)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {xTicks.map((i) => (
          <text
            key={i}
            x={xOf(i)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {formatDate(points[i].date)}
          </text>
        ))}

        <circle
          cx={xOf(points.length - 1)}
          cy={yOf(points[points.length - 1].percent)}
          r={4}
          fill="var(--progress)"
          stroke="var(--card)"
          strokeWidth={2}
        />

        {hovered ? (
          <g>
            <line
              x1={xOf(hover!)}
              x2={xOf(hover!)}
              y1={padding.top}
              y2={padding.top + innerH}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={xOf(hover!)}
              cy={yOf(hovered.percent)}
              r={4.5}
              fill="var(--progress)"
              stroke="var(--card)"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>

      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs shadow-md"
          style={{
            left: Math.min(width - 60, Math.max(60, xOf(hover!))),
            top: Math.max(0, yOf(hovered.percent) - 42),
          }}
        >
          <div className="tabular font-medium">{formatTenth(hovered.percent)} %</div>
          <div className="text-muted-foreground">{formatDate(hovered.date)}</div>
        </div>
      ) : null}
    </div>
  );
}
