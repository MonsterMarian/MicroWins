"use client";

import * as React from "react";
import { useStore } from "@/components/providers/store-provider";
import { ProjectsHub } from "@/components/projects/projects-hub";

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-16 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-28 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}

export default function HomePage() {
  const { hydrated } = useStore();

  if (!hydrated) return <Skeleton />;

  // Rozkliknutá záložka se čte z adresy (`?tab=`), a `useSearchParams`
  // potřebuje hranici Suspense - jinak statický export neprojde buildem.
  return (
    <React.Suspense fallback={<Skeleton />}>
      <ProjectsHub />
    </React.Suspense>
  );
}
