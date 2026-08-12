"use client";

import * as React from "react";
import { tapFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

/**
 * Přetahování řádků do vlastního pořadí.
 *
 * Postavené na Pointer Events, ne na HTML5 drag & drop - ten na Androidu
 * v prstu nefunguje vůbec.
 *
 * Spouští se **podržením prstu**, ne úchytem. Úchyt vlevo zabíral místo
 * v každém řádku kvůli akci, která se dělá jednou za měsíc, a prst po něm
 * musel mířit. Teď platí jednoduché pravidlo: prst se hne = stránka scroluje,
 * prst chvíli počká = řádek se zvedne a jde přetáhnout.
 *
 * Proto se do puštění drží dvě fáze. Po dotyku se jen čeká a nic se nepřebíjí,
 * aby scrolování zůstalo plynulé a nativní; teprve když prst vydrží `HOLD`
 * bez pohybu, přebírá se gesto. Klíčové je, že se do té chvíle prst nepohnul -
 * prohlížeč tedy ještě nezačal scrolovat a `preventDefault` na dalších
 * pohybech scrolování spolehlivě zabrání.
 *
 * Během tažení se nic neukládá. Ostatní řádky se jen posunou transformem,
 * takže se nepřepočítávají procenta ani se nesahá na stav - nové pořadí se
 * pošle až po puštění, jedním voláním `onReorder`.
 */

/** Jak dlouho prst vydrží, než se řádek zvedne. */
const HOLD = 420;
/** O kolik se smí prst mezitím pohnout, než to vezmeme jako scrolování. */
const SLOP = 10;

interface DragState {
  /** Index taženého řádku v původním pořadí. */
  index: number;
  /** Kam by řádek spadl, kdyby se teď pustil. */
  to: number;
  /** Posun prstu od začátku tažení (v pixelech stránky, ne okna). */
  dy: number;
  height: number;
}

interface Session {
  id: string;
  index: number;
  to: number;
  pointerId: number;
  /** Začátek tažení v souřadnicích stránky - okno se během tažení posouvá. */
  startPageY: number;
  startClientX: number;
  startClientY: number;
  clientY: number;
  rows: { top: number; height: number }[];
  raf: number;
  /** Dokud je `false`, jen se čeká na podržení a gesto patří prohlížeči. */
  dragging: boolean;
  hold: number;
  element: HTMLElement | null;
  /** Odvěšení posluchačů okna - drží se u sezení, ať se nezapomene. */
  detach: () => void;
}

interface SortableApi {
  ids: string[];
  drag: DragState | null;
  disabled: boolean;
  /** Řádek, který čeká na dokončení podržení - kreslí se přišlápnutý. */
  pressed: string | null;
  register: (id: string, el: HTMLElement | null) => void;
  press: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  /** Po tažení nesmí projít klik, jinak by se pod prstem otevřel detail. */
  swallowClick: React.RefObject<boolean>;
}

const SortableContext = React.createContext<SortableApi | null>(null);

/** Jak blízko k okraji okna se seznam začne sám odjíždět. */
const EDGE = 72;
const EDGE_SPEED = 14;

export function SortableList({
  ids,
  onReorder,
  disabled = false,
  className,
  children,
}: {
  /** Id viditelných řádků shora dolů - musí sedět na pořadí `children`. */
  ids: string[];
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const nodes = React.useRef(new Map<string, HTMLElement>());
  const session = React.useRef<Session | null>(null);
  const swallowClick = React.useRef(false);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [pressed, setPressed] = React.useState<string | null>(null);

  // Posluchače tažení visí na okně a nesmí se přepínat při každém pohybu -
  // aktuální seznam a callback si proto berou z refu.
  const latest = React.useRef({ ids, onReorder });
  latest.current = { ids, onReorder };

  const register = React.useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const update = React.useCallback((clientY: number) => {
    const s = session.current;
    if (!s || !s.dragging) return;
    s.clientY = clientY;

    const dy = clientY + window.scrollY - s.startPageY;
    const row = s.rows[s.index];
    const center = row.top + row.height / 2 + dy;

    let to = s.index;
    s.rows.forEach((other, i) => {
      if (i === s.index) return;
      const otherCenter = other.top + other.height / 2;
      if (i < s.index && center < otherCenter) to = Math.min(to, i);
      if (i > s.index && center > otherCenter) to = Math.max(to, i);
    });

    if (to !== s.to) void tapFeedback();
    s.to = to;
    setDrag((prev) => (prev && prev.dy === dy && prev.to === to ? prev : prev && { ...prev, dy, to }));
  }, []);

  /** Dlouhý seznam se nedá projet prstem - u kraje okna se odjíždí sám. */
  const autoScroll = React.useCallback(() => {
    const s = session.current;
    if (!s || !s.dragging) return;
    const above = EDGE - s.clientY;
    const below = s.clientY - (window.innerHeight - EDGE);
    const speed =
      above > 0
        ? -EDGE_SPEED * Math.min(1, above / EDGE)
        : below > 0
          ? EDGE_SPEED * Math.min(1, below / EDGE)
          : 0;
    if (speed !== 0) {
      window.scrollBy(0, speed);
      update(s.clientY);
    }
    s.raf = requestAnimationFrame(autoScroll);
  }, [update]);

  /**
   * Podržení dozrálo: teprve tady se gesto přebírá prohlížeči. Rozměry řádků
   * se měří až v tenhle okamžik, ne při dotyku - mezitím mohl seznam doskákat
   * dorovnáním obrázků a stará čísla by řádek posílala vedle.
   */
  const engage = React.useCallback(() => {
    const s = session.current;
    if (!s || s.dragging) return;

    const rects = latest.current.ids.map((rowId) =>
      nodes.current.get(rowId)?.getBoundingClientRect(),
    );
    const index = latest.current.ids.indexOf(s.id);
    if (index < 0 || rects.some((r) => r === undefined)) {
      session.current = null;
      s.detach();
      setPressed(null);
      return;
    }

    s.dragging = true;
    s.index = index;
    s.to = index;
    s.rows = rects.map((r) => ({ top: r!.top + window.scrollY, height: r!.height }));
    s.startPageY = s.startClientY + window.scrollY;

    try {
      // Prst může zmizet dřív, než se sem kód dostane - pak zachytávat není co.
      s.element?.setPointerCapture(s.pointerId);
    } catch {
      // tažení pojede i bez toho, události se chytají na okně
    }

    void tapFeedback();
    setPressed(null);
    setDrag({ index, to: index, dy: 0, height: rects[index]!.height });
  }, []);

  /**
   * Dotyk. Zatím se jen čeká - žádné `preventDefault`, aby prst mohl seznam
   * normálně projet.
   */
  const press = React.useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (disabled || session.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (latest.current.ids.indexOf(id) < 0) return;

      const pointerId = event.pointerId;
      const element = event.currentTarget;

      const onMove = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        if (s.dragging) {
          if (e.cancelable) e.preventDefault();
          update(e.clientY);
          return;
        }
        // Prst se hnul dřív, než podržení dozrálo - patří to scrolování.
        if (Math.hypot(e.clientX - s.startClientX, e.clientY - s.startClientY) > SLOP) cancel();
      };

      /**
       * Scrolování se nedá vypnout přes `touch-action` - ten se vyhodnocuje na
       * začátku gesta a to už dávno běží. Musí se proto odmítat každý pohyb,
       * a posluchač kvůli tomu nesmí být pasivní.
       */
      const onTouchMove = (e: TouchEvent) => {
        if (session.current?.dragging && e.cancelable) e.preventDefault();
      };

      const onEnd = (e: PointerEvent) => {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        const wasDragging = s.dragging;
        const { index, to } = s;
        cancel();
        if (!wasDragging || to === index) return;

        const next = [...latest.current.ids];
        const [moved] = next.splice(index, 1);
        next.splice(to, 0, moved);
        latest.current.onReorder(next);
      };

      const cancel = () => {
        const s = session.current;
        if (!s) return;
        session.current = null;
        window.clearTimeout(s.hold);
        cancelAnimationFrame(s.raf);
        s.detach();
        if (s.dragging) {
          /* Po tažení následuje klik na řádek - ten musí spadnout pod stůl,
             jinak by se pod prstem otevřel detail. Značka se po chvíli maže
             sama: když klik nepřijde (gesto přerušil systém), nesmí spolknout
             ten příští, opravdový. */
          swallowClick.current = true;
          window.setTimeout(() => {
            swallowClick.current = false;
          }, 400);
        }
        setPressed(null);
        setDrag(null);
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("touchmove", onTouchMove);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("touchmove", onTouchMove, { passive: false });

      session.current = {
        id,
        index: -1,
        to: -1,
        pointerId,
        startPageY: event.clientY + window.scrollY,
        startClientX: event.clientX,
        startClientY: event.clientY,
        clientY: event.clientY,
        rows: [],
        raf: 0,
        dragging: false,
        hold: window.setTimeout(() => {
          engage();
          const s = session.current;
          if (s?.dragging) s.raf = requestAnimationFrame(autoScroll);
        }, HOLD),
        element,
        detach,
      };

      setPressed(id);
    },
    [disabled, update, autoScroll, engage],
  );

  // Odchod ze stránky uprostřed tažení nesmí nechat viset posluchače okna.
  React.useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      window.clearTimeout(s.hold);
      cancelAnimationFrame(s.raf);
      s.detach();
    },
    [],
  );

  const dragging = drag !== null;

  const api = React.useMemo<SortableApi>(
    () => ({ ids, drag, disabled, pressed, register, press, swallowClick }),
    [ids, drag, disabled, pressed, register, press],
  );

  return (
    <SortableContext.Provider value={api}>
      <div className={cn(dragging && "select-none", className)}>{children}</div>
    </SortableContext.Provider>
  );
}

export function SortableItem({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(SortableContext);
  if (!ctx) throw new Error("SortableItem musí být uvnitř SortableList");
  const { ids, drag, disabled, pressed, register, press, swallowClick } = ctx;

  const index = ids.indexOf(id);
  const active = drag !== null && drag.index === index;
  const waiting = pressed === id;

  let shift = 0;
  if (drag && !active) {
    if (index > drag.index && index <= drag.to) shift = -drag.height;
    if (index < drag.index && index >= drag.to) shift = drag.height;
  }
  const offset = active ? drag.dy : shift;

  return (
    <div
      ref={(el) => register(id, el)}
      onPointerDown={disabled ? undefined : (e) => press(id, e)}
      // Podržení prstu na odkazu vyvolá nabídku prohlížeče a výběr textu -
      // obojí by se pralo s tažením.
      onContextMenu={(e) => {
        if (!disabled) e.preventDefault();
      }}
      /*
       * Myš na řádku, který je odkaz, spustí nativní tažení odkazu. To spolkne
       * `pointermove` i `pointerup`, takže sezení uvnitř zůstane viset a řádek
       * se nikam nepřesune. Na dotyku se to neděje, proto se chyba ukázala
       * teprve na počítači.
       */
      onDragStart={(e) => e.preventDefault()}
      draggable={false}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        transform: offset ? `translateY(${offset}px)` : undefined,
        // Tažený řádek musí jít přesně pod prstem, ostatní se doklouzají.
        transition: active ? "none" : "transform 0.16s ease",
      }}
      className={cn(
        "relative bg-card transition-[box-shadow,transform]",
        active && "z-20 scale-[1.02] rounded-lg shadow-lg ring-1 ring-border",
        // Během čekání drobné přišlápnutí: bez něj není poznat, že se něco děje.
        waiting && !active && "scale-[0.99]",
        (active || waiting) && "select-none [-webkit-touch-callout:none]",
        drag && !active && "z-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
