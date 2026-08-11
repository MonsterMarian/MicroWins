/**
 * Pohyb čísel a hlídání změn.
 *
 * Procenta se nepřepínají skokem - dopočítají se nahoru, takže je vidět,
 * o kolik se posunula. Kdo má v systému vypnuté animace, dostane hodnotu
 * rovnou; nic tu na animaci nestojí, jen se bez ní nic nehýbe.
 */
"use client";

import * as React from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** Rychlý rozjezd, měkký dojezd - stejná křivka jako u pruhu. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Číslo, které se k cíli dopočítá místo skoku. Přerušená animace pokračuje
 * z místa, kde byla - dvě rychlá ťuknutí za sebou tak nezpůsobí cuknutí zpátky.
 */
export function useAnimatedNumber(value: number, duration = 520): number {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = React.useState(value);
  const current = React.useRef(value);
  /* První hodnota přijde až po načtení z úložiště. Načtení dat není pohyb
     uživatele, takže se na ni jen skočí - jinak by se po každém otevření
     appky všechna procenta natáčela od nuly. */
  const primed = React.useRef(false);

  React.useEffect(() => {
    if (reduced || !primed.current) {
      primed.current = true;
      current.current = value;
      setDisplay(value);
      return;
    }

    const from = current.current;
    if (Math.abs(from - value) < 0.005) {
      current.current = value;
      setDisplay(value);
      return;
    }

    const start = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const next = from + (value - from) * easeOutCubic(t);
      current.current = next;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        current.current = value;
        setDisplay(value);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  return display;
}

export interface ValueChange {
  /** O kolik hodnota naposledy poskočila. Kladné i záporné. */
  delta: number;
  /** Roste s každou změnou - hodí se jako `key`, aby se animace pustila znovu. */
  nonce: number;
}

/**
 * Ohlásí každou změnu hodnoty. První hodnota (načtení z úložiště) se za změnu
 * nepovažuje, jinak by appka po startu blikala přírůstky, které nikdo neudělal.
 */
export function useValueChange(value: number): ValueChange | null {
  const previous = React.useRef<number | null>(null);
  const [change, setChange] = React.useState<ValueChange | null>(null);
  const nonce = React.useRef(0);

  React.useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before === null || Math.abs(value - before) < 0.005) return;
    nonce.current += 1;
    setChange({ delta: value - before, nonce: nonce.current });
  }, [value]);

  return change;
}
