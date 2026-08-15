"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Flame, FolderKanban, ListTree, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings-dialog";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useTrackNavigation } from "@/components/providers/use-app-back";
import { useSwipeNav } from "@/components/providers/use-swipe-nav";
import { applyAccent } from "@/lib/prefs";
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
    // Stavová lišta musí sednout na téma z localStorage (nastavuje ho skript
    // v layoutu ještě před prvním paintem). Přepínač v hlavičce už není,
    // takže se o to při startu nikdo jiný nepostará.
    void syncStatusBar(document.documentElement.classList.contains("dark"));
    // Doběhli jsme až sem, takže tenhle balík umí naběhnout - značka o
    // rozjetém startu může pryč, jinak by ho příští spuštění vrátilo zpět.
    markBootSucceeded();
    // Nejdřív nasadit balík stažený minule, teprve pak koukat po novém.
    // Když se nasadilo, WebView se překresluje a kontrola nemá smysl.
    void applyPendingUpdate().then((res) => {
      if (!res.applied) void checkForUpdate();
    });
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

const NAV_ROUTES = NAV.map((n) => n.href);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { accent, headerLogo } = usePrefs();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [native, setNative] = React.useState(false);

  useNativeShell();
  useTrackNavigation();
  /*
   * Přejíždění mezi sekcemi platí jen na těch třech - v detailu projektu nebo
   * úkolu by odvedlo od rozdělané práce a v úkolu si vodorovný tah bere
   * posuvník hodnoty. `normalizePath` kvůli statickému exportu, ten na konec
   * adresy přidává lomítko.
   */
  useSwipeNav(NAV_ROUTES, normalizePath(pathname));
  React.useEffect(() => setNative(isNative()), []);
  // Skript v hlavičce barvu nasadí před prvním paintem; tohle ji drží
  // v souladu i po přepnutí v Nastavení a po načtení zálohy.
  React.useEffect(() => applyAccent(accent), [accent]);

  return (
    <div className={cn("flex min-h-screen flex-col", native && "select-none")}>
      <header className="mw-safe-top mw-safe-x sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-4">
          <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
            {headerLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo-new.jpg" alt="" className="size-7 rounded-lg object-cover" />
            ) : null}
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

      {/* pt-6, ne py-6: spodní odsazení řeší mw-pad-nav a py-6 by ho přebilo. */}
      <main className="mw-pad-nav mx-auto w-full max-w-4xl flex-1 px-4 pt-6">{children}</main>

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
              // Název jen pro čtečku obrazovky - ikony stačí, ale odkaz bez
              // textu by se jinak ohlásil jako prázdný.
              aria-label={label}
              title={label}
              className={cn(
                "flex flex-1 items-center justify-center py-3 transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-16 items-center justify-center rounded-full transition-colors",
                  active && "bg-secondary",
                )}
              >
                <Icon className="size-5" />
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
