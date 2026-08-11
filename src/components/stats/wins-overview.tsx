"use client";

import * as React from "react";
import { Check, Gauge, Star, Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { formatDateRelative } from "@/lib/date";
import { recentMicrowins, winDetail, type MicrowinItem } from "@/lib/stats";
import type { NodeKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Víc už se do přehledu nevejde - starší patří do kalendáře a do stromu. */
const LIMIT = 10;

/**
 * Poslední microwiny v Analýze.
 *
 * Dřív si tahle sekce vybírala z pěti pohledů na sledované winy, ale přepínaly
 * se schované v Nastavení a odpovídaly na otázky, které si nikdo nekladl.
 * Zbyl jeden seznam a jedna otázka: co naposled padlo.
 */
export function WinsOverview() {
  const { state, today } = useStore();
  const items = React.useMemo(() => recentMicrowins(state, LIMIT), [state]);

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Poslední microwiny</CardTitle>
        <CardDescription>
          {state.microwins.length > LIMIT
            ? `Nejnovějších ${LIMIT} z celkem ${state.microwins.length}.`
            : "Co zatím padlo, od nejnovějšího."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="-mx-2 flex flex-col">
          {items.map((item) => (
            <WinRow key={item.microwin.id} item={item} today={today} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const KIND_ICON: Record<Exclude<NodeKind, "category">, React.ElementType> = {
  metric: Gauge,
  check: Check,
  once: Star,
};

function WinRow({ item, today }: { item: MicrowinItem; today: string }) {
  const Icon = KIND_ICON[item.kind as Exclude<NodeKind, "category">] ?? Trophy;
  const isToday = item.microwin.date === today;

  return (
    <li
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-2",
        isToday && "bg-win-muted/40",
      )}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          isToday ? "bg-win text-win-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {isToday ? <Trophy className="size-3.5" /> : <Icon className="size-3.5" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={item.text}>
          {item.text}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {item.path ? `${item.path} · ` : ""}
          {winDetail(item)}
        </span>
      </span>

      <span className="tabular shrink-0 text-xs text-muted-foreground">
        {formatDateRelative(item.microwin.date)}
      </span>
    </li>
  );
}
