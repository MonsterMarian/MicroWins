"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pole, které roste s textem.
 *
 * V prioritách ani v políčku mřížky není kam dlouhý zápis rozkliknout, takže
 * ho tam nejde useknout - místo toho přibude řádek. Výška se počítá z obsahu
 * po každé změně: nejdřív na nulu, pak na `scrollHeight`, jinak by pole
 * zůstalo nafouklé i po smazání textu.
 */
export const AutoTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function AutoTextarea({ className, value, ...props }, forwarded) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);

  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof forwarded === "function") forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );

  const resize = React.useCallback(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useLayoutEffect(resize, [value, resize]);

  /*
   * Výška se musí přepočítat i při změně šířky, ne jen textu: pole změřené
   * v úzkém (nebo zrovna nulovém) sloupci si napočítá desítky řádků a v té
   * výšce by zůstalo, i když se sloupec roztáhne. Sleduje se jen šířka -
   * na vlastní změnu výšky se reagovat nesmí, to by se točilo dokola.
   */
  React.useEffect(() => {
    const el = inner.current;
    if (!el) return;
    let last = el.getBoundingClientRect().width;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === last) return;
      last = width;
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={setRef}
      rows={1}
      value={value}
      {...props}
      /* Šířku si říká volající: `w-full` by v řádku s dalšími prvky přetlačilo
         sousedy, pole by se zmáčklo na pár písmen a výška spočítaná z obsahu
         by vyskočila na desítky řádků. */
      className={cn(
        "min-w-0 resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/60",
        className,
      )}
    />
  );
});
