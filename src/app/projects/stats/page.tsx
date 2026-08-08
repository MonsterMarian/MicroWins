"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ProjectAnalytics } from "@/components/projects/project-analytics";

function ProjectStatsInner() {
  const id = useSearchParams().get("id") ?? "";
  return <ProjectAnalytics projectId={id} />;
}

export default function ProjectStatsPage() {
  return (
    <React.Suspense fallback={<div className="h-64 animate-pulse rounded-xl border bg-muted/40" />}>
      <ProjectStatsInner />
    </React.Suspense>
  );
}
