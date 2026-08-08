"use client";

import * as React from "react";
import { Check, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { onceEntry, summarizeFlag } from "@/lib/domain";
import { cn, plural } from "@/lib/utils";

/**
 * Winy bez čísla. Do "Rekordů podle metrik" nepatří - nemají rekord ani denní
 * součet, jen dny, kdy se to stalo.
 */
export function FlagsTable() {
  const { state, today } = useStore();

  const rows = React.useMemo(() => {
    const checks = state.nodes
      .filter((n) => n.kind === "check")
      .map((n) => summarizeFlag(state, n, today))
      .sort((a, b) => b.dayCount - a.dayCount);

    const onces = state.nodes
      .filter((n) => n.kind === "once")
      .map((n) => ({
        summary: summarizeFlag(state, n, today),
        date: onceEntry(state.entries, n.id)?.date ?? null,
      }))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    return { checks, onces };
  }, [state, today]);

  if (rows.checks.length === 0 && rows.onces.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Winy bez čísla</CardTitle>
        <CardDescription>
          Zaškrtávací se opakují, jednorázové se staly jednou.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-y">
              <th className="px-5 py-2 text-left font-medium">Win</th>
              <th className="px-3 py-2 text-right font-medium">Dnů</th>
              <th className="px-3 py-2 text-right font-medium">Série</th>
              <th className="px-5 py-2 text-right font-medium">Naposledy</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.checks.map((r) => (
              <tr key={r.node.id} className={cn(r.doneToday && "bg-win-muted/30")}>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Check className="size-3.5 text-muted-foreground" />
                    {r.node.name}
                  </div>
                  {r.path ? <div className="text-xs text-muted-foreground">{r.path}</div> : null}
                </td>
                <td className="tabular px-3 py-2.5 text-right font-medium">{r.dayCount}</td>
                <td className="tabular px-3 py-2.5 text-right">
                  {r.streak > 0 ? (
                    `${r.streak} ${plural(r.streak, "den", "dny", "dní")}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right">
                  {r.doneToday ? (
                    <Badge variant="win">dnes</Badge>
                  ) : r.lastDate ? (
                    <span className="tabular text-muted-foreground">{formatDate(r.lastDate)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}

            {rows.onces.map((r) => (
              <tr key={r.summary.node.id}>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Star className="size-3.5 text-muted-foreground" />
                    {r.summary.node.name}
                  </div>
                  {r.summary.path ? (
                    <div className="text-xs text-muted-foreground">{r.summary.path}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-muted-foreground" colSpan={2}>
                  jednorázový
                </td>
                <td className="px-5 py-2.5 text-right">
                  {r.date ? (
                    <span className="tabular text-muted-foreground">{formatDate(r.date)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
