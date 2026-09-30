"use client";

import * as React from "react";
import {
  getAccount,
  getServerAccount,
  initAccount,
  subscribeAccount,
  type AccountState,
} from "@/lib/account";

/**
 * Stav účtu. Store je čistý modul v `lib/account.ts`, tady je jen most do
 * Reactu - stejně jako u nastavení. První použití zjistí, kdo je přihlášený.
 */
export function useAccount(): AccountState {
  React.useEffect(() => initAccount(), []);
  return React.useSyncExternalStore(subscribeAccount, getAccount, getServerAccount);
}
