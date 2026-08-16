"use client";

import { useStore } from "@/components/providers/store-provider";
import { TodayPanel } from "@/components/today-panel";
import { TreeView } from "@/components/tree/tree-view";

export default function TreePage() {
  const { hydrated } = useStore();

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <TodayPanel />
      <TreeView />
    </div>
  );
}
