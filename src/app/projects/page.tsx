"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ProjectDetail } from "@/components/projects/project-detail";

/**
 * Detail projektu jede přes `?id=`, ne přes dynamickou routu.
 * Statický export (a tím i APK) neumí předgenerovat cesty pro id, která
 * vzniknou až v telefonu.
 */
function ProjectPageInner() {
  const id = useSearchParams().get("id") ?? "";
  return <ProjectDetail projectId={id} />;
}

export default function ProjectPage() {
  return (
    <React.Suspense fallback={<div className="h-64 animate-pulse rounded-xl border bg-muted/40" />}>
      <ProjectPageInner />
    </React.Suspense>
  );
}
