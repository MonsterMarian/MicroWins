"use client";

import * as React from "react";

/**
 * Vrstvy, které má zavřít hardwarové tlačítko Zpět, dřív než se odejde
 * z obrazovky. Nejnovější vrstva se zavírá první - otevřený panel nad panelem
 * se tak zavírá po jednom.
 */
const layers: (() => void)[] = [];

/** Zavře nejvyšší vrstvu. `false` = žádná není, Zpět patří obrazovce. */
export function closeTopLayer(): boolean {
  const close = layers[layers.length - 1];
  if (!close) return false;
  close();
  return true;
}

/** Dokud je `open`, zavře vrstvu tlačítko Zpět. */
export function useBackClose(open: boolean, onClose: () => void): void {
  const latest = React.useRef(onClose);
  latest.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    const close = () => latest.current();
    layers.push(close);
    return () => {
      const at = layers.lastIndexOf(close);
      if (at !== -1) layers.splice(at, 1);
    };
  }, [open]);
}
