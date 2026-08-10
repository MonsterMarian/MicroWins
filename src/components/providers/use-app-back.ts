"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Tlačítko Zpět v detailech.
 *
 * `router.back()` je správná odpověď, dokud je kam se vracet - vrátí i stav
 * seznamu (rozkliknutá záložka, pozice ve výpisu). Když ale appka naběhla
 * rovnou na detailu (odkaz zvenčí, obnovený tab, studený start nativní appky),
 * v historii nic není a tlačítko by nedělalo nic. Proto se počítají přechody
 * uvnitř appky a bez nich se jde na náhradní adresu.
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

export function useAppBack(): (fallback: string) => void {
  const router = useRouter();
  return React.useCallback(
    (fallback: string) => {
      if (inAppNavigations > 0) router.back();
      else router.replace(fallback);
    },
    [router],
  );
}
