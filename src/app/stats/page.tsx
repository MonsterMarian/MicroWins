"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { LastDaysStrip } from "@/components/stats/day-table";
import { FlagsTable } from "@/components/stats/flags-table";
import { Heatmap } from "@/components/stats/heatmap";
import { PortfolioAnalytics } from "@/components/stats/portfolio-analytics";
import { RecordsTable } from "@/components/stats/records-table";
import { StatCards } from "@/components/stats/stat-cards";
import { cn } from "@/lib/utils";

type Section = "wins" | "projects";

export default function StatsPage() {
  const { hydrated, state } = useStore();
  const [section, setSection] = React.useState<Section>("wins");

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-28 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Analýza</h1>
        <p className="text-sm text-muted-foreground">
          Série microwinů a tempo projektů na jednom místě.
        </p>
      </header>

      <div className="flex gap-1 border-b">
        {(
          [
            { id: "wins", label: "Microwiny a série" },
            { id: "projects", label: "Projekty" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              section === t.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "wins" ? (
        <>
          <StatCards />

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">Posledních 14 dní</h2>
            <LastDaysStrip />
          </section>

          {state.microwins.length > 0 ? <Heatmap /> : null}
          <RecordsTable />
          <FlagsTable />
        </>
      ) : (
        <PortfolioAnalytics />
      )}
    </div>
  );
}
