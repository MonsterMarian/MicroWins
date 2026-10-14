"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { tickFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";
import type { TimeboxDrag } from "./use-timebox-drag";

/**
 * List dne ve dvou stránkách vedle sebe.
 *
 * Vlevo brain dump a rozvrh, vpravo rozdělaná práce, Nestihl jsem a trojka
 * hlavních věcí. Dřív bylo všech pět sekcí pod sebou a každá věc se táhla
 * přes celý list dolů nebo nahoru - s prstem u spodní hrany, kde se stránka
 * sama roluje, to byla loterie. Teď je druhá polovina listu jedno švihnutí
 * vedle.
 *
 * Mezi stránkami se jde třemi cestami:
 * - švihnutím (stránky jsou vodorovný scroller se zaklapnutím, takže švih
 *   vyřeší prohlížeč; přejetí mezi sekcemi appky si scrolleru všímá a na
 *   kraji listu teprve přepne sekci),
 * - ťuknutím na přepínač nad listem,
 * - při tahu věci: prst u kraje displeje nebo nad přepínačem chvíli podrží
 *   a stránka se otočí, takže se věc pustí na druhé straně.
 *
 * Na širší obrazovce (od `sm`) jsou obě stránky vedle sebe a nic se nepřepíná.
 */

/** Jak blízko kraje displeje musí prst při tahu být, aby otočil stránku. */
const EDGE = 36;
/** Jak dlouho tam musí vydržet - kratší dotyk kraje je jen míření. */
const FLIP_DELAY = 380;

export function SheetPager({
  labels,
  drag,
  children,
}: {
  labels: [string, string];
  drag: TimeboxDrag;
  children: [React.ReactNode, React.ReactNode];
}) {
  const pager = React.useRef<HTMLDivElement | null>(null);
  const pages = React.useRef<(HTMLDivElement | null)[]>([null, null]);
  const [page, setPage] = React.useState(0);
  /** Stránka stojí na místě (ne uprostřed švihu). */
  const [settled, setSettled] = React.useState(true);
  const [height, setHeight] = React.useState<number | null>(null);
  const [wide, setWide] = React.useState(false);
  const [flipping, setFlipping] = React.useState<number | null>(null);

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setWide(mq.matches);
    update();
    // Změna média nemusí přijít (emulace, některé WebView) - otočení tabletu
    // ale vždycky pohne velikostí okna.
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const goTo = React.useCallback((index: number, smooth = true) => {
    const box = pager.current;
    const target = pages.current[index];
    if (!box || !target) return;
    box.scrollTo({ left: target.offsetLeft, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const onScroll = () => {
    const box = pager.current;
    const second = pages.current[1];
    if (!box || !second || second.offsetLeft <= 0) return;
    const position = box.scrollLeft / second.offsetLeft;
    const index = Math.min(1, Math.max(0, Math.round(position)));
    setPage(index);
    setSettled(Math.abs(position - index) < 0.02);
  };

  /* Scroller je vysoký jako vyšší stránka - na krátké pravé by pod ní zela
     prázdná plocha, do které jde rolovat. Stojící stránka proto určuje výšku
     sama; během švihu je vidět obě, tak se nechá výška volná. */
  React.useEffect(() => {
    const el = pages.current[page];
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [page]);

  /* Otočená stránka začíná nahoře. Kdo byl v rozvrhu dole u večera, uviděl
     by po švihu na krátkou stránku jen prázdno - list se proto vrátí na
     začátek, a běžící tah si pak najde cíl pod prstem znovu. */
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const box = pager.current;
    if (!box || wide) return;
    const top = box.getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top - 80);
    drag.refresh();
  }, [page, wide, drag.refresh]);

  /* Otočení stránky při tahu: prst u kraje displeje (nebo nad přepínačem)
     vydrží chvíli na místě. Časovač, ne rAF - stačí vědět, že prst
     neodjel, a ve skrytém WebView rAF stejně nejede. */
  const flip = React.useRef<{ to: number; timer: number } | null>(null);
  const ghost = drag.ghost;
  const overTrash = drag.target?.kind === "trash";
  React.useEffect(() => {
    const clear = () => {
      if (flip.current) window.clearTimeout(flip.current.timer);
      flip.current = null;
      setFlipping(null);
    };
    if (!ghost || wide || overTrash) {
      clear();
      return;
    }
    let to: number | null = null;
    const tab = document.elementFromPoint(ghost.x, ghost.y)?.closest<HTMLElement>("[data-sheet-page]");
    if (tab) to = Number(tab.dataset.sheetPage);
    else if (ghost.x < EDGE) to = page - 1;
    else if (ghost.x > window.innerWidth - EDGE) to = page + 1;

    if (to === null || to < 0 || to > 1 || to === page) {
      clear();
      return;
    }
    if (flip.current?.to === to) return;
    clear();
    const target = to;
    setFlipping(target);
    flip.current = {
      to: target,
      timer: window.setTimeout(() => {
        flip.current = null;
        setFlipping(null);
        goTo(target, false);
        void tickFeedback();
      }, FLIP_DELAY),
    };
  }, [ghost, overTrash, page, wide, goTo]);

  React.useEffect(
    () => () => {
      if (flip.current) window.clearTimeout(flip.current.timer);
    },
    [],
  );

  const other = page === 0 ? 1 : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Přepínač je i cíl tahu: věc podržená nad ním otočí stránku. */}
      <div role="tablist" className="flex rounded-lg border bg-muted/40 p-0.5 sm:hidden">
        {labels.map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={page === index}
            data-sheet-page={index}
            onClick={() => goTo(index)}
            className={cn(
              "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
              page === index ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              flipping === index && "bg-primary/15 text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        ref={pager}
        onScroll={onScroll}
        // Výška jen přes proměnnou a jen pod `sm` - na širší obrazovce ji CSS
        // zahodí samo, i kdyby se o změně šířky skript nedozvěděl.
        style={settled && height ? ({ "--pager-h": `${height}px` } as React.CSSProperties) : undefined}
        className={cn(
          "relative flex snap-x snap-mandatory items-start gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          settled && height && "h-[var(--pager-h)]",
          "sm:grid sm:h-auto sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:gap-3 sm:overflow-visible",
        )}
      >
        {children.map((child, index) => (
          <div
            key={index}
            ref={(el) => {
              pages.current[index] = el;
            }}
            aria-label={labels[index]}
            className="flex w-full min-w-0 shrink-0 snap-start snap-always flex-col gap-3 sm:w-auto"
          >
            {child}
          </div>
        ))}
      </div>

      {/* Při tahu ukazuje kraj displeje, že za ním je druhá stránka. */}
      {ghost && !wide ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none fixed top-1/2 z-[44] flex -translate-y-1/2 items-center gap-0.5 rounded-full border bg-background/95 px-2 py-3 text-[10px] font-medium text-muted-foreground shadow-md backdrop-blur transition-colors",
            other === 1
              ? "right-[calc(0.25rem+var(--mw-safe-right))] flex-row"
              : "left-[calc(0.25rem+var(--mw-safe-left))] flex-row-reverse",
            flipping === other && "border-primary bg-primary text-primary-foreground",
          )}
        >
          <span className="max-w-[4.5rem] text-center leading-tight">{labels[other]}</span>
          {other === 1 ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </div>
      ) : null}
    </div>
  );
}
