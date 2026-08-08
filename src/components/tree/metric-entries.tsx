"use client";

import * as React from "react";
import { Check, Trash2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { formatDate, formatDateRelative } from "@/lib/date";
import {
  aggregationOf,
  entriesOfMetric,
  isMarkedOn,
  onceEntry,
  summarizeFlag,
  totalsByDay,
} from "@/lib/domain";
import type { TreeNode } from "@/lib/types";
import { formatNumber, plural } from "@/lib/utils";

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

/**
 * Zaškrtávací win: seznam odškrtnutých dnů + doplnění zapomenutého dne.
 * Žádná čísla - jen "ten den ano".
 */
export function CheckEntries({ node }: { node: TreeNode }) {
  const { state, today, toggleCheck } = useStore();
  const summary = summarizeFlag(state, node, today);
  const [date, setDate] = React.useState(today);

  const days = React.useMemo(
    () => entriesOfMetric(state.entries, node.id),
    [state.entries, node.id],
  );

  const alreadyMarked = isMarkedOn(state.entries, node.id, date);

  return (
    <div className="flex flex-col gap-2">
      {days.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          Zatím nezaškrtnuto. První zaškrtnutí je rovnou microwin.
        </p>
      ) : (
        <ul className="flex flex-col">
          {days.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 border-b border-dashed py-1.5 last:border-0"
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                {d.date === today ? "dnes" : formatDate(d.date)}
              </span>
              <Badge variant="win">
                <Check /> hotovo
              </Badge>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Zrušit ${formatDate(d.date)}`}
                  onClick={() => toggleCheck(node.id, d.date)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
          <li className="pt-2 text-xs text-muted-foreground">
            {summary.dayCount} {plural(summary.dayCount, "den", "dny", "dní")} celkem
            {summary.lastDate ? `, naposledy ${formatDateRelative(summary.lastDate, today)}` : ""}.
          </li>
        </ul>
      )}

      <div className="flex items-end gap-2 border-t pt-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Doplnit den
          <Input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
            className="h-8 w-40"
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={alreadyMarked}
          onClick={() => toggleCheck(node.id, date)}
        >
          <Check /> {alreadyMarked ? "Už je zaškrtnuto" : "Zaškrtnout"}
        </Button>
      </div>
    </div>
  );
}

/** Jednorázový win: jen datum, poznámka a fakt, že je hotový. */
export function OnceDetail({ node }: { node: TreeNode }) {
  const { state, today } = useStore();
  const entry = onceEntry(state.entries, node.id);

  if (!entry) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        Bez data - uprav win a doplň den, kdy se to stalo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">
          {entry.date === today ? "dnes" : formatDate(entry.date)}
        </span>
        <Badge variant="win">
          <Trophy /> hotovo
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatDateRelative(entry.date, today)}
        </span>
      </div>
      {entry.note ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{entry.note}</p>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">Bez poznámky.</p>
      )}
    </div>
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
