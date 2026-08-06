"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { metricsOf, summarizeMetric } from "@/lib/domain";
import { byRootCategory } from "@/lib/stats";
import { cn, formatNumber, plural } from "@/lib/utils";

export function RecordsTable() {
  const { state, today } = useStore();
  const rows = React.useMemo(
    () =>
      metricsOf(state.nodes)
        .map((m) => summarizeMetric(state, m, today))
        .sort((a, b) => b.microwinCount - a.microwinCount || b.record.value - a.record.value),
    [state, today],
  );

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rekordy podle metrik</CardTitle>
        <CardDescription>Nejlepší denní výkon a jak na tom jsi dnes.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-y">
              <th className="px-5 py-2 text-left font-medium">Metrika</th>
              <th className="px-3 py-2 text-right font-medium">Rekord</th>
              <th className="px-3 py-2 text-right font-medium">Dnes</th>
              <th className="px-3 py-2 text-right font-medium">Microwiny</th>
              <th className="px-5 py-2 text-right font-medium">Zápisů</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.metric.id} className={cn(r.hasMicrowinToday && "bg-win-muted/30")}>
                <td className="px-5 py-2.5">
                  <div className="font-medium">{r.metric.name}</div>
                  {r.path ? (
                    <div className="text-xs text-muted-foreground">{r.path}</div>
                  ) : null}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {r.record.value > 0 ? (
                    <>
                      <div className="font-medium">
                        {formatNumber(r.record.value)}
                        {r.metric.unit ? ` ${r.metric.unit}` : ""}
                      </div>
                      {r.record.date ? (
                        <div className="text-xs text-muted-foreground">
                          {formatDate(r.record.date)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  {r.todayTotal > 0 ? (
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{formatNumber(r.todayTotal)}</span>
                      {!r.hasMicrowinToday && r.toRecord > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          chybí {formatNumber(r.toRecord)}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right">{r.microwinCount}</td>
                <td className="tabular px-5 py-2.5 text-right text-muted-foreground">
                  {r.entryCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function CategoryBreakdown() {
  const { state } = useStore();
  const rows = React.useMemo(() => byRootCategory(state), [state]);
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rozložení podle oblastí</CardTitle>
        <CardDescription>Kde microwiny opravdu padají.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const pct = Math.round((r.count / total) * 100);
          return (
            <div key={r.node.id} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm">{r.node.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-win" style={{ width: `${pct}%` }} />
              </div>
              <Badge variant="outline" className="tabular shrink-0">
                {r.count} {plural(r.count, "microwin", "microwiny", "microwinů")} · {pct} %
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
