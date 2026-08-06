"use client";

import * as React from "react";
import { CalendarCheck, CalendarRange, Flame, Star, Trophy, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { streaks, totals } from "@/lib/stats";
import { cn, plural } from "@/lib/utils";

export function StatCards() {
  const { state, today } = useStore();
  const t = React.useMemo(() => totals(state, today), [state, today]);
  const s = React.useMemo(() => streaks(state, today), [state, today]);

  const cards = [
    {
      icon: Flame,
      label: "Aktuální série",
      value: `${s.current} ${plural(s.current, "den", "dny", "dní")}`,
      hint: s.todayDone
        ? "dnešek zapsaný"
        : s.atRisk
          ? "dnes ještě nic - série visí na vlásku"
          : "začni novou",
      accent: s.todayDone,
    },
    {
      icon: Star,
      label: "Nejdelší série",
      value: `${s.longest} ${plural(s.longest, "den", "dny", "dní")}`,
      hint: s.current > 0 && s.current >= s.longest ? "právě teď ji držíš" : "osobní maximum",
    },
    {
      icon: Trophy,
      label: "Microwinů celkem",
      value: String(t.allTime),
      hint: `${t.avgPerActiveDay} na aktivní den`,
    },
    {
      icon: Zap,
      label: "Posledních 7 dní",
      value: String(t.last7),
      hint: `30 dní: ${t.last30}`,
    },
    {
      icon: CalendarRange,
      label: "Tento měsíc",
      value: String(t.thisMonth),
      hint: `dnes: ${t.today}`,
    },
    {
      icon: CalendarCheck,
      label: "Nejlepší den",
      value: t.bestDay ? String(t.bestDay.count) : "—",
      hint: t.bestDay ? formatDate(t.bestDay.date) : "zatím žádný",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cards.map(({ icon: Icon, label, value, hint, accent }) => (
        <Card key={label} className={cn("p-4", accent && "border-win/40 bg-win-muted/40")}>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className={cn("size-3.5", accent && "text-win")} />
            {label}
          </div>
          <p className="tabular mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </p>
        </Card>
      ))}
    </div>
  );
}
