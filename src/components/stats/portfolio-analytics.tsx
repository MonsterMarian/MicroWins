"use client";

import * as React from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyBarChart } from "@/components/charts/bar-chart";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import {
  MOVEMENT_PERIODS,
  MOVEMENT_PERIOD_LABEL,
  MOVEMENT_PERIOD_PHRASE,
  type MovementPeriod,
  displayPercent,
  portfolioActivity,
  projectMovements,
} from "@/lib/projects";
import { cn, formatTenth, plural } from "@/lib/utils";

/**
 * Projektová část analýzy - denní tempo a posun projektů za období.
 *
 * Všechno se počítá a píše v procentech, ne v "bodech". Rozdíl dvou procent
 * je sice procentní bod, ale projekt se nikde jinde v appce ani v reálu
 * neměří v bodech - "+12 %" je to, co člověk čeká.
 */
export function PortfolioAnalytics() {
  const { state, today } = useStore();
  const [period, setPeriod] = React.useState<MovementPeriod>("week");

  const activity = React.useMemo(() => portfolioActivity(state, 30, today), [state, today]);
  const moved = React.useMemo(() => projectMovements(state, period, today), [state, period, today]);

  if (state.projects.length === 0) return null;

  const activeDays = activity.filter((a) => a.gain > 0).length;
  const totalGain = formatTenth(activity.reduce((s, a) => s + a.gain, 0));
  const periodGain = moved.reduce((s, m) => s + m.delta, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Tempo projektů</CardTitle>
          <CardDescription>
            Přírůstek za posledních 30 dní · {activeDays}{" "}
            {plural(activeDays, "aktivní den", "aktivní dny", "aktivních dní")} · celkem +
            {totalGain} %
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DailyBarChart points={activity.map((a) => ({ date: a.date, value: a.gain }))} unit=" %" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle>Posun</CardTitle>
              <CardDescription>
                {moved.length === 0
                  ? `Nic se nepohnulo ${MOVEMENT_PERIOD_PHRASE[period]}.`
                  : `${moved.length} ${plural(moved.length, "projekt se pohnul", "projekty se pohnuly", "projektů se pohnulo")} ${MOVEMENT_PERIOD_PHRASE[period]} · celkem ${periodGain >= 0 ? "+" : "−"}${formatTenth(Math.abs(periodGain))} %`}
              </CardDescription>
            </div>
            <PeriodSwitch value={period} onChange={setPeriod} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {moved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Posuň libovolný úkol a projekt se sem zapíše.
            </p>
          ) : (
            moved.map((m) => {
              const up = m.delta > 0;
              const [from, to] = fromTo(m.from, m.to);
              return (
                <Link
                  key={m.project.id}
                  href={`/projects?id=${m.project.id}`}
                  className="flex flex-col gap-1 rounded-md px-1 py-1 hover:bg-accent/50"
                >
                  <div className="flex items-center gap-2">
                    <EntityIcon icon={m.project.icon} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">{m.project.name}</span>
                    <span
                      className={cn(
                        "tabular inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                        up
                          ? "border-progress/40 bg-progress-muted/40 text-progress-muted-foreground"
                          : "border-destructive/40 text-destructive",
                      )}
                    >
                      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                      {up ? "+" : "−"}
                      {formatTenth(Math.abs(m.delta))} %
                    </span>
                  </div>
                  <MovementBar from={m.from} to={m.to} />
                  <p className="tabular text-[11px] text-muted-foreground">
                    {from} % → <span className="font-medium text-foreground">{to} %</span>
                  </p>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Dvojice "odkud → kam". Procenta se jinde v appce zaokrouhlují dolů, jenže
 * u malého posunu (74,6 → 75,0) by z toho bylo "75 % → 75 %" u řádku, který
 * hlásí +0,4 %. Když se obě čísla potkají na stejné celé hodnotě, ukáže se
 * desetina.
 */
function fromTo(from: number, to: number): [string, string] {
  if (displayPercent(from) === displayPercent(to) && Math.abs(to - from) >= 0.05) {
    return [formatTenth(from), formatTenth(to)];
  }
  return [String(displayPercent(from)), String(displayPercent(to))];
}

/** Přepínač období nad seznamem posunů. */
function PeriodSwitch({
  value,
  onChange,
}: {
  value: MovementPeriod;
  onChange: (next: MovementPeriod) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
      {MOVEMENT_PERIODS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {MOVEMENT_PERIOD_LABEL[id]}
        </button>
      ))}
    </div>
  );
}

/**
 * Pruh posunu. Bledá část je stav na začátku období, sytá to, co za období
 * přibylo - jde tak vidět, jestli projekt povyrostl z nuly nebo dotahuje
 * poslední kus. Pokles se kreslí červeně na místě, kde procenta ubyla.
 */
function MovementBar({ from, to }: { from: number; to: number }) {
  const base = Math.max(0, Math.min(100, Math.min(from, to)));
  const change = Math.max(0, Math.min(100, Math.max(from, to)) - base);

  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-track shadow-[inset_0_1px_2px_rgb(0_0_0/0.16)]">
      <div
        className="absolute inset-y-0 left-0 rounded-l-full bg-progress/40"
        style={{ width: `${base}%` }}
      />
      <div
        className={cn("absolute inset-y-0", to >= from ? "bg-progress" : "bg-destructive/70")}
        style={{ left: `${base}%`, width: `${change}%` }}
      />
    </div>
  );
}
