"use client";

import * as React from "react";
import { Trash2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/components/providers/store-provider";
import { formatDate, formatDateRelative } from "@/lib/date";
import { aggregationOf, entriesOfMetric, totalsByDay } from "@/lib/domain";
import type { TreeNode } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

/** Záznamy metriky seskupené po dnech - "x za jeden den" je denní veličina. */
export function MetricEntries({ metric }: { metric: TreeNode }) {
  const { state, today, deleteEntry } = useStore();

  const aggregation = aggregationOf(metric);
  const entries = entriesOfMetric(state.entries, metric.id);
  const days = React.useMemo(
    () =>
      [...totalsByDay(entries, aggregation).entries()].sort((a, b) => b[0].localeCompare(a[0])),
    [entries, aggregation],
  );

  if (entries.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        Zatím žádný záznam. První zápis k dnešku je rovnou microwin.
      </p>
    );
  }

  const winDates = new Set(
    state.microwins.filter((m) => m.metricId === metric.id).map((m) => m.date),
  );
  const unit = metric.unit ? ` ${metric.unit}` : "";

  return (
    <ul className="flex flex-col">
      {days.map(([date, total]) => {
        const dayEntries = entries.filter((e) => e.date === date);
        return (
          <li key={date} className="border-b border-dashed last:border-0">
            <div className="flex items-center gap-2 py-1.5">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {date === today ? "dnes" : formatDate(date)}
              </span>
              <span className="tabular text-sm font-medium">
                {formatNumber(total)}
                {unit}
              </span>
              {winDates.has(date) ? (
                <Badge variant="win">
                  <Trophy /> microwin
                </Badge>
              ) : null}
              {dayEntries.length > 1 ? (
                <span className="text-xs text-muted-foreground">
                  {dayEntries.length}× {aggregation === "sum" ? "sečteno" : "nejlepší z"}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                {dayEntries.length === 1 ? (
                  <EntryActions
                    note={dayEntries[0].note}
                    backdated={dayEntries[0].backdated}
                    onDelete={() => deleteEntry(dayEntries[0].id)}
                  />
                ) : null}
              </div>
            </div>

            {dayEntries.length > 1 ? (
              <ul className="mb-1.5 ml-28 flex flex-col gap-1">
                {dayEntries.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular">
                      {formatNumber(e.value)}
                      {unit}
                    </span>
                    <span className="truncate">{e.note}</span>
                    <div className="ml-auto">
                      <EntryActions
                        backdated={e.backdated}
                        onDelete={() => deleteEntry(e.id)}
                        compact
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
      <li className="pt-2 text-xs text-muted-foreground">
        Poslední zápis {formatDateRelative(entries[0].date, today)}.
      </li>
    </ul>
  );
}

function EntryActions({
  note,
  backdated,
  onDelete,
  compact,
}: {
  note?: string;
  backdated?: boolean;
  onDelete: () => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {note && !compact ? (
        <span className="max-w-[16rem] truncate text-xs text-muted-foreground">{note}</span>
      ) : null}
      {backdated ? (
        <span className="text-xs text-muted-foreground" title="Zpětný zápis - bez microwinu">
          zpětně
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Smazat záznam"
        onClick={onDelete}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
