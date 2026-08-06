"use client";

import { useStore } from "@/components/providers/store-provider";
import { ProjectsHub } from "@/components/projects/projects-hub";

export default function HomePage() {
  const { hydrated } = useStore();

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-16 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-28 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  return <ProjectsHub />;
}
