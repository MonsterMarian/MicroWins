"use client";

import * as React from "react";
import { Check, Gauge, Sparkles, Star, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { usePrefs } from "@/components/providers/use-prefs";
import { FlagsTable } from "@/components/stats/flags-table";
import { RecordsTable } from "@/components/stats/records-table";
import { useStore } from "@/components/providers/store-provider";
import { formatDate, formatDateRelative } from "@/lib/date";
import { WINS_VIEWS } from "@/lib/prefs";
import { winOverview, type WinOverview } from "@/lib/stats";
import type { NodeKind } from "@/lib/types";
import { cn, formatNumber, plural } from "@/lib/utils";

/**
 * Přehled winů v Analýze.
 *
 * Původní tabulka měla pět sloupců na každou metriku a s pár desítkami winů
 * se nedala přečíst. Místo jednoho kompromisu je tu několik pohledů, každý
 * odpovídá na jinou otázku - a přepínají se v Nastavení, ať je obrazovka
 * v klidu. "Úplná tabulka" je pro případ, že jsou fakt potřeba všechna čísla.
 */
export function WinsOverview() {
  const { state, today } = useStore();
  const { winsView } = usePrefs();
  const wins = React.useMemo(() => winOverview(state, today), [state, today]);

  if (wins.length === 0) return null;

  if (winsView === "table") {
    return (
      <>
        <RecordsTable />
        <FlagsTable />
      </>
    );
  }

  const view = WINS_VIEWS.find((v) => v.id === winsView) ?? WINS_VIEWS[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Winy</CardTitle>
        <CardDescription>
          {view.label} - {view.hint}. Přepnout jde v Nastavení.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {winsView === "compact" ? <CompactView wins={wins} /> : null}
        {winsView === "progress" ? <ProgressView wins={wins} /> : null}
        {winsView === "focus" ? <FocusView wins={wins} /> : null}
        {winsView === "ranking" ? <RankingView wins={wins} /> : null}
      </CardContent>
    </Card>
  );
}

const KIND_ICON: Record<Exclude<NodeKind, "category">, React.ElementType> = {
  metric: Gauge,
  check: Check,
  once: Star,
};

function KindIcon({ kind }: { kind: WinOverview["kind"] }) {
  const Icon = KIND_ICON[kind];
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** Řádek se sjednoceným začátkem: ikona druhu, název, cesta jako popisek. */
function WinName({ win, className }: { win: WinOverview; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <KindIcon kind={win.kind} />
      <span className="min-w-0 truncate text-sm" title={win.node.name}>
        {win.node.name}
      </span>
      {win.path ? (
        <span className="hidden min-w-0 shrink truncate text-xs text-muted-foreground sm:inline">
          {win.path}
        </span>
      ) : null}
    </div>
  );
}

/** Jedno číslo napravo - u každého druhu to nejdůležitější. */
function headline(win: WinOverview): string {
  if (win.kind === "metric") {
    if (win.record <= 0) return "bez zápisu";
    return `rekord ${formatNumber(win.record)}${win.unit ? ` ${win.unit}` : ""}`;
  }
  if (win.kind === "check") {
    return `${win.dayCount} ${plural(win.dayCount, "den", "dny", "dní")}`;
  }
  return win.date ? formatDate(win.date) : "bez data";
}

/** Nejmíň informací, co dává smysl: co to je a jak na tom stojím. */
function CompactView({ wins }: { wins: WinOverview[] }) {
  const sorted = React.useMemo(
    () =>
      [...wins].sort(
        (a, b) =>
          Number(b.activeToday) - Number(a.activeToday) ||
          b.microwinCount - a.microwinCount ||
          a.node.name.localeCompare(b.node.name, "cs"),
      ),
    [wins],
  );

  return (
    <ul className="-mx-2 flex flex-col">
      {sorted.map((win) => (
        <li
          key={win.node.id}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5",
            win.winToday && "bg-win-muted/40",
          )}
        >
          <WinName win={win} className="flex-1" />
          {win.activeToday ? (
            <Badge variant={win.winToday ? "win" : "default"} className="tabular shrink-0">
              {win.winToday ? <Trophy /> : null}
              {win.kind === "metric" ? formatNumber(win.todayTotal) : "dnes"}
            </Badge>
          ) : null}
          <span className="tabular shrink-0 text-xs text-muted-foreground">{headline(win)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Jak daleko je dnešek od rekordu. Číselné winy dostanou pruh, zaškrtávací
 * posledních sedm dnů - u nich žádný rekord není, ale série ano.
 */
function ProgressView({ wins }: { wins: WinOverview[] }) {
  const sorted = React.useMemo(
    () =>
      [...wins].sort((a, b) => {
        const pa = a.kind === "metric" ? a.progress : a.activeToday ? 100 : 0;
        const pb = b.kind === "metric" ? b.progress : b.activeToday ? 100 : 0;
        return pb - pa || b.microwinCount - a.microwinCount;
      }),
    [wins],
  );

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((win) => (
        <li key={win.node.id} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <WinName win={win} className="flex-1" />
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {win.kind === "metric"
                ? win.record > 0
                  ? `${formatNumber(win.todayTotal)} / ${formatNumber(win.record)}`
                  : "bez zápisu"
                : win.kind === "check"
                  ? win.streak > 0
                    ? `série ${win.streak}`
                    : "série 0"
                  : win.date
                    ? formatDateRelative(win.date)
                    : "bez data"}
            </span>
          </div>

          {win.kind === "metric" ? (
            <div className="flex items-center gap-2">
              <ProgressBar
                value={win.progress}
                size="sm"
                tone={win.winToday ? "win" : "muted"}
                className="flex-1"
              />
              <span className="tabular w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                {win.winToday
                  ? "rekord dnes!"
                  : win.toRecord > 0 && win.record > 0
                    ? `chybí ${formatNumber(win.toRecord)}`
                    : "—"}
              </span>
            </div>
          ) : null}

          {win.kind === "check" ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {win.recentDays.map((done, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      done ? "bg-win" : "bg-track",
                      // Poslední políčko je dnešek - ať je vidět, co ještě chybí.
                      i === 6 && !done && "ring-1 ring-foreground/25",
                    )}
                  />
                ))}
              </div>
              <span className="tabular w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                {win.doneToday ? "dnes hotovo" : "dnes chybí"}
              </span>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Co dnes padlo a co je na dosah - jediný pohled, který se dívá dopředu. */
function FocusView({ wins }: { wins: WinOverview[] }) {
  const done = wins.filter((w) => w.winToday);

  // Na dosah: číselný win s rozdělaným dneškem blízko rekordu, nebo
  // zaškrtávací s běžící sérií, kterému chybí dnešek.
  const close = wins
    .filter(
      (w) =>
        (w.kind === "metric" && !w.winToday && w.record > 0 && w.todayTotal > 0) ||
        (w.kind === "check" && !w.doneToday && w.streak > 0),
    )
    .sort((a, b) => {
      if (a.kind === "metric" && b.kind === "metric") return b.progress - a.progress;
      return a.kind === "metric" ? -1 : 1;
    })
    .slice(0, 6);

  if (done.length === 0 && close.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Dnes zatím nic. Cokoli nad rekord je microwin.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {done.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dnes padlo
          </h4>
          <ul className="flex flex-col gap-1">
            {done.map((win) => (
              <li
                key={win.node.id}
                className="flex items-center gap-2 rounded-md bg-win-muted/50 px-2 py-1.5"
              >
                <Trophy className="size-4 shrink-0 text-win" />
                <WinName win={win} className="flex-1" />
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {win.kind === "metric" ? formatNumber(win.todayTotal) : "hotovo"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {close.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Na dosah
          </h4>
          <ul className="flex flex-col gap-1">
            {close.map((win) => (
              <li key={win.node.id} className="flex items-center gap-2 px-2 py-1">
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                <WinName win={win} className="flex-1" />
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {win.kind === "metric"
                    ? `chybí ${formatNumber(win.toRecord)}`
                    : `série ${win.kind === "check" ? win.streak : 0} visí`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Kde se rekordy lámou nejčastěji. */
function RankingView({ wins }: { wins: WinOverview[] }) {
  const sorted = React.useMemo(
    () =>
      [...wins]
        .filter((w) => w.microwinCount > 0)
        .sort((a, b) => b.microwinCount - a.microwinCount),
    [wins],
  );

  if (sorted.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Zatím žádný microwin - žebříček bude mít co řadit po prvním zápisu.
      </p>
    );
  }

  const max = sorted[0].microwinCount;

  return (
    <ol className="flex flex-col gap-2">
      {sorted.map((win, i) => (
        <li key={win.node.id} className="flex items-center gap-2">
          <span className="tabular w-5 shrink-0 text-right text-xs text-muted-foreground">
            {i + 1}.
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <WinName win={win} className="flex-1" />
              <span className="tabular shrink-0 text-xs font-medium">{win.microwinCount}</span>
            </div>
            <ProgressBar
              value={(win.microwinCount / max) * 100}
              size="sm"
              tone={win.winToday ? "win" : "muted"}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
