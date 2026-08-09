"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Flame, FolderKanban, ListTree, Moon, Settings, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings-dialog";
import { useStore } from "@/components/providers/store-provider";
import { applyPendingUpdate, checkForUpdate, markBootSucceeded } from "@/lib/live-update";
import { hideSplash, isNative, registerBackButton, syncStatusBar } from "@/lib/native";
import { streaks } from "@/lib/stats";
import { cn, plural } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Projekty", icon: FolderKanban },
  { href: "/tree", label: "Strom", icon: ListTree },
  { href: "/stats", label: "Analýza", icon: BarChart3 },
];

/** Statický export přidává lomítko na konec ("/tree/"), porovnává se bez něj. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** Detail projektu i úkolu spadá pod záložku Projekty. */
function isActive(pathname: string, href: string): boolean {
  const path = normalizePath(pathname);
  if (href === "/") {
    return path === "/" || path.startsWith("/projects") || path.startsWith("/tasks");
  }
  return path === href || path.startsWith(`${href}/`);
}

function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
    void syncStatusBar(isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    void syncStatusBar(next);
    try {
      localStorage.setItem("microwins:theme", next ? "dark" : "light");
    } catch {
      // soukromý režim - téma se prostě nezapamatuje
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Přepnout téma">
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function StreakBadge() {
  const { state, today, hydrated } = useStore();
  const info = React.useMemo(() => streaks(state, today), [state, today]);

  if (!hydrated || info.current === 0) return null;

  return (
    <Badge
      variant={info.todayDone ? "win" : "outline"}
      title={info.todayDone ? "Dnešek už máš zapsaný" : "Dnes ještě žádný microwin"}
      className="tabular"
    >
      <Flame className={cn(info.todayDone ? "text-win" : "text-muted-foreground")} />
      {info.current} {plural(info.current, "den", "dny", "dní")}
    </Badge>
  );
}

/**
 * Nativní chování appky: schování splash screenu po prvním vykreslení
 * a hardwarové tlačítko Zpět. V prohlížeči se nic z toho nespustí.
 */
function useNativeShell() {
  const pathname = usePathname();
  const router = useRouter();
  const atRoot = React.useRef(true);
  atRoot.current = NAV.some((n) => n.href === normalizePath(pathname));

  React.useEffect(() => {
    void hideSplash();
    // Doběhli jsme až sem, takže tenhle balík umí naběhnout - značka o
    // rozjetém startu může pryč, jinak by ho příští spuštění vrátilo zpět.
    markBootSucceeded();
    // Nejdřív nasadit balík stažený minule, teprve pak koukat po novém.
    void applyPendingUpdate().then(() => checkForUpdate());
  }, []);

  React.useEffect(() => {
    let cleanup = () => {};
    void registerBackButton(() => {
      // Uvnitř detailu se vrátíme, na záložce necháme systém appku zavřít.
      if (atRoot.current) return false;
      router.back();
      return true;
    }).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup();
  }, [router]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [native, setNative] = React.useState(false);

  useNativeShell();
  React.useEffect(() => setNative(isNative()), []);

  return (
    <div className={cn("flex min-h-screen flex-col", native && "select-none")}>
      <header className="mw-safe-top mw-safe-x sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-4">
          <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
            MicroWins
          </Link>

          {/* Na mobilu navigace patří dolů pod palec, ne nahoru. */}
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                  isActive(pathname, href)
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <StreakBadge />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Nastavení"
              title="Nastavení"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-24 sm:pb-6">{children}</main>

      <BottomNav pathname={pathname} />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

/** Spodní lišta se záložkami - standardní navigace Android appky. */
function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav className="mw-safe-bottom mw-safe-x fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur sm:hidden">
      <div className="mx-auto flex w-full max-w-4xl">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition-colors",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                  active && "bg-secondary",
                )}
              >
                <Icon className="size-5" />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
