"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Přejíždění mezi sekcemi prstem.
 *
 * Sekce jsou tři vedle sebe (Projekty - Strom - Analýza) a spodní lišta je
 * dělá dostupné na jedno ťuknutí. Tahle cesta je pro palec: doleva = další
 * sekce, doprava = předchozí. Nikam se necyklí - z krajní sekce se dál nejde,
 * protože "swipe mě vrátil na začátek" je nepříjemné překvapení a člověk
 * pak neví, kde v řadě stojí.
 *
 * Gesto se poznává až po puštění, ne průběžně: přejetí musí vyhrát nad
 * scrolováním, a to se dá spolehlivě rozhodnout jedině z celého tvaru pohybu.
 *
 * Jen dotyk a pero. Myš ne - tahem myši se na počítači vybírá text a stránka
 * by odskakovala tomu, kdo si chtěl označit odstavec.
 */

/** Kolik pixelů musí prst ujet do strany, než se to bere jako přejetí. */
const DISTANCE = 64;
/** Kolikrát víc do strany než nahoru/dolů - jinak je to scrolování. */
const RATIO = 1.6;
/** Dýl už to není mávnutí, ale rozmyšlené tahání. */
const MAX_DURATION = 700;

interface Track {
  pointerId: number;
  x: number;
  y: number;
  at: number;
  /** Kam prst dopadl - scroller se hledá od něj, ne od místa puštění. */
  target: EventTarget | null;
  /** Gesto je zrušené (dialog, pole formuláře, druhý prst). */
  dead: boolean;
}

/**
 * Míří prst do něčeho, co se samo posouvá do strany?
 *
 * Uvnitř vodorovného scrolleru (cesta ve stromu, široká tabulka, kalendář
 * roku) patří gesto jemu, ne navigaci - ale jen dokud tam je kam posouvat.
 * Doscrollovaná tabulka na svém konci už prst nepotřebuje.
 */
function insideHorizontalScroller(target: EventTarget | null, dx: number): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll") {
      const room = node.scrollWidth - node.clientWidth;
      if (room > 1) {
        // Prst doleva posouvá obsah doprava, tedy scrollLeft nahoru.
        const consumes = dx < 0 ? node.scrollLeft < room - 1 : node.scrollLeft > 1;
        if (consumes) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

/** Do prvků, které si vodorovný tah řeší samy, se nesmí sahat. */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [role='slider'], [contenteditable='true'], [data-no-swipe]",
    ),
  );
}

export function useSwipeNav(routes: string[], current: string): void {
  const router = useRouter();

  // Posluchače visí na okně a nesmí se přepínat při každém pohybu prstu.
  const latest = React.useRef({ routes, current });
  latest.current = { routes, current };

  React.useEffect(() => {
    let track: Track | null = null;

    const go = (direction: -1 | 1) => {
      const { routes: list, current: here } = latest.current;
      const index = list.indexOf(here);
      if (index === -1) return;
      const next = index + direction;
      if (next < 0 || next >= list.length) return;
      router.push(list[next]);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      // Druhý prst na displeji = štípání nebo omyl, ne přejetí.
      if (track) {
        track.dead = true;
        return;
      }
      track = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        at: Date.now(),
        target: e.target,
        dead: isInteractive(e.target) || document.querySelector("[role='dialog']") !== null,
      };
    };

    const onUp = (e: PointerEvent) => {
      const t = track;
      track = null;
      if (!t || t.dead || t.pointerId !== e.pointerId) return;

      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (Date.now() - t.at > MAX_DURATION) return;
      if (Math.abs(dx) < DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * RATIO) return;

      // Na scroller se ptáme až tady: na začátku gesta ještě není známý směr.
      if (insideHorizontalScroller(t.target, dx)) return;
      // Prst doleva = obsah odjíždí doleva = jsme o sekci dál.
      go(dx < 0 ? 1 : -1);
    };

    const onCancel = () => {
      track = null;
    };

    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [router]);
}
