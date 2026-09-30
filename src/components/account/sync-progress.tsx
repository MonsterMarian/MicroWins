"use client";

import * as React from "react";
import { useSyncStatus } from "@/components/providers/use-sync";
import { progressLabel, progressPercent } from "@/lib/sync-runtime";

/** Běžná synchronizace trvá zlomek sekundy - pruh by jen problikl. */
const SHOW_AFTER_MS = 300;
/** Popisek až u přenosu, který chvíli trvá, nebo je velký od začátku. */
const LABEL_AFTER_MS = 1000;
const BIG_TRANSFER = 100;

/**
 * Pruh přes horní okraj obrazovky, když se něco stahuje nebo nahrává.
 *
 * Tenký a bez tlačítek schválně: synchronizace běží sama a nic se kvůli ní
 * nečeká, jen má být vidět, že se děje. U delšího přenosu (první spojení
 * telefonu s účtem, stažení účtu do nového zařízení) se pod pruhem objeví
 * i kolik toho je - "Nahrávám do účtu 500 / 843".
 */
export function SyncProgressBar() {
  const sync = useSyncStatus();
  const busy = sync.phase === "syncing" || sync.phase === "checking";
  const [shown, setShown] = React.useState(false);
  const [labelled, setLabelled] = React.useState(false);

  // Mezi stahováním a nahráváním je chvilka bez průběhu - drží se to na
  // fázi, ne na průběhu, jinak by pruh blikal.
  React.useEffect(() => {
    if (!busy) {
      setShown(false);
      setLabelled(false);
      return;
    }
    const show = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    const label = window.setTimeout(() => setLabelled(true), LABEL_AFTER_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(label);
    };
  }, [busy]);

  if (!busy || !shown) return null;

  const progress = sync.progress;
  const percent = progress ? progressPercent(progress) : null;
  const text = progress
    ? progressLabel(progress)
    : sync.phase === "checking"
      ? "Zjišťuju, co je v účtu…"
      : "Synchronizuju…";
  const withLabel = labelled || (progress?.total ?? 0) >= BIG_TRANSFER;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center pt-[var(--mw-safe-top)]"
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <div className="h-[3px] w-full overflow-hidden bg-track/60">
        {percent === null ? (
          <div className="mw-indeterminate h-full w-1/4 rounded-full bg-progress" />
        ) : (
          <div
            className="h-full rounded-r-full bg-progress transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(4, percent)}%` }}
          />
        )}
      </div>
      {/* Pod hlavičkou, ne přes ni - tam je menu a nesmí se schovat. */}
      {withLabel ? (
        <span className="tabular animate-in-up mt-[4.25rem] flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md">
          <span className="size-1.5 animate-pulse rounded-full bg-progress" aria-hidden />
          {text}
        </span>
      ) : null}
    </div>
  );
}
