"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { TaskAnalytics } from "@/components/projects/task-analytics";

function TaskStatsInner() {
  const id = useSearchParams().get("id") ?? "";
  return <TaskAnalytics taskId={id} />;
}

export default function TaskStatsPage() {
  return (
    <React.Suspense fallback={<div className="h-64 animate-pulse rounded-xl border bg-muted/40" />}>
      <TaskStatsInner />
    </React.Suspense>
  );
}
