"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { TaskDetail } from "@/components/projects/task-detail";

function TaskPageInner() {
  const id = useSearchParams().get("id") ?? "";
  return <TaskDetail taskId={id} />;
}

export default function TaskPage() {
  return (
    <React.Suspense fallback={<div className="h-64 animate-pulse rounded-xl border bg-muted/40" />}>
      <TaskPageInner />
    </React.Suspense>
  );
}
