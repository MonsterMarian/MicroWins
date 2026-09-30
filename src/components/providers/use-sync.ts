"use client";

import * as React from "react";
import { getServerSyncStatus, getSyncStatus, subscribeSync, type SyncStatus } from "@/lib/sync-runtime";

/** Stav synchronizace - most z `lib/sync-runtime.ts` do Reactu, jako u účtu. */
export function useSyncStatus(): SyncStatus {
  return React.useSyncExternalStore(subscribeSync, getSyncStatus, getServerSyncStatus);
}
