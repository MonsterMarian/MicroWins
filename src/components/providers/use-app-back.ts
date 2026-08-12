"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Šipka zpět v detailech.
 *
 * Nevrací se v historii, ale **o úroveň výš ve stromu**: z podúkolu na úkol,
 * z úkolu na projekt, z projektu na seznam. Stejně se chová strom microwinů
 * a je to jediné chování, které jde předvídat - `router.back()` po delším
 * proklikávání vracel tam, odkud člověk přišel, což u třetího kliknutí
 * znamenalo skok do úplně jiné části appky.
 *
 * Historii přesto počítáme: když appka naběhla rovnou na detailu (odkaz
 * zvenčí, obnovený tab, studený start nativní appky), nemá `push` na co
 * navázat a je čistší cíl nahradit, aby v zásobníku nezůstala prázdná stopa.
 */
let inAppNavigations = 0;

/** Volá se jednou v `AppShell` - jinde by se přechody počítaly víckrát. */
export function useTrackNavigation(): void {
  const pathname = usePathname();
  const first = React.useRef(true);

  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    inAppNavigations += 1;
  }, [pathname]);
}

/** Vrátí funkci „jdi na tuhle nadřazenou obrazovku". */
export function useGoUp(): (href: string) => void {
  const router = useRouter();
  return React.useCallback(
    (href: string) => {
      if (inAppNavigations > 0) router.push(href);
      else router.replace(href);
    },
    [router],
  );
}
