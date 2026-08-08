"use client";

import * as React from "react";
import { CalendarCheck, Check, Flag, Flame, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { dayName, formatDate } from "@/lib/date";
import { dayRows, streaks, winDetail } from "@/lib/stats";
import {
  achievedMilestones,
  nextMilestones,
  type MilestoneKind,
  type WinMilestone,
} from "@/lib/milestones";
import { formatNumber, plural } from "@/lib/utils";

export function TodayPanel() {
  const { state, today } = useStore();

  const streak = React.useMemo(() => streaks(state, today), [state, today]);
  const todayRow = React.useMemo(
    () => dayRows(state).find((r) => r.date === today) ?? null,
    [state, today],
  );

  const count = todayRow?.count ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {dayName(today)} · {formatDate(today)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {count === 0
              ? "Dnes zatím žádný microwin"
              : `${count} ${plural(count, "microwin", "microwiny", "microwinů")} dnes`}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {streak.current > 0 ? (
            <Badge variant={streak.todayDone ? "solid" : "outline"} className="tabular">
              <Flame /> série {streak.current} {plural(streak.current, "den", "dny", "dní")}
            </Badge>
          ) : null}
          {streak.longest > 0 ? (
            <Badge variant="outline" className="tabular">
              rekordní série {streak.longest}
            </Badge>
          ) : null}
        </div>
      </div>

      {count > 0 ? (
        <ul className="flex flex-col gap-1 px-5 pb-4">
          {todayRow?.items.map((item) => (
            <li
              key={item.microwin.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-win-muted/60 px-3 py-2"
            >
              <Trophy className="size-4 shrink-0 text-win" />
              <span className="text-sm font-medium">{item.text}</span>
              <span className="text-xs text-muted-foreground">{winDetail(item)}</span>
              {item.path ? (
                <span className="ml-auto text-xs text-muted-foreground">{item.path}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <MilestonesSection />
    </Card>
  );
}

const KIND_ICON: Record<MilestoneKind, React.ComponentType<{ className?: string }>> = {
  total: Trophy,
  streak: Flame,
  activeDays: CalendarCheck,
};

/**
 * Milníky se nikde nezaškrtávají - `lib/milestones.ts` je počítá ze stavu,
 * takže se překlopí ve chvíli, kdy microwin nebo den série skutečně padne.
 */
function MilestonesSection() {
  const { state } = useStore();
  const next = React.useMemo(() => nextMilestones(state), [state]);
  const done = React.useMemo(() => achievedMilestones(state), [state]);

  if (next.length === 0 && done.length === 0) return null;

  return (
    <div className="border-t bg-muted/30 px-5 py-3">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Flag className="size-3.5" />
        Milníky
        {done.length > 0 ? (
          <span className="tabular font-normal">
            · {done.length} {plural(done.length, "splněný", "splněné", "splněných")}
          </span>
        ) : null}
      </p>

      <ul className="flex flex-col gap-2.5">
        {next.map((m) => (
          <MilestoneRow key={m.id} milestone={m} />
        ))}
      </ul>

      {done.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
          {done.slice(0, 8).map((m) => (
            <li key={m.id}>
              <Badge
                variant="outline"
                className="tabular"
                title={m.achievedOn ? `splněno ${formatDate(m.achievedOn)}` : undefined}
              >
                <Check /> {m.label}
              </Badge>
            </li>
          ))}
          {done.length > 8 ? (
            <li className="self-center text-xs text-muted-foreground">
              a další {done.length - 8}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function MilestoneRow({ milestone }: { milestone: WinMilestone }) {
  const Icon = KIND_ICON[milestone.kind];
  const remaining = Math.max(0, milestone.target - milestone.current);
  const pct = (milestone.current / milestone.target) * 100;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm">{milestone.label}</span>
        <span className="tabular ml-auto shrink-0 text-xs text-muted-foreground">
          {formatNumber(milestone.current)} / {formatNumber(milestone.target)} · chybí{" "}
          {formatNumber(remaining)}
        </span>
      </div>
      <ProgressBar value={pct} size="sm" tone="win" />
    </li>
  );
}
