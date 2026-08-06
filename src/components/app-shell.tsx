"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Database, Flame, FolderKanban, ListTree, Moon, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataDialog } from "@/components/data-dialog";
import { useStore } from "@/components/providers/store-provider";
import { streaks } from "@/lib/stats";
import { cn, plural } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Projekty", icon: FolderKanban },
  { href: "/tree", label: "Strom", icon: ListTree },
  { href: "/stats", label: "Analýza", icon: BarChart3 },
];

/** Detail projektu i úkolu spadá pod záložku Projekty. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/projects") || pathname.startsWith("/tasks");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dataOpen, setDataOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-2 px-4">
          <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground text-[11px] font-bold">
              MW
            </span>
            MicroWins
          </Link>

          <nav className="flex items-center gap-1">
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
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <StreakBadge />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Data"
              onClick={() => setDataOpen(true)}
            >
              <Database />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>

      <footer className="mx-auto w-full max-w-4xl px-4 pb-8 pt-2 text-xs text-muted-foreground">
        Projekty měří postup v procentech, strom sbírá denní rekordy. Microwin = nový denní rekord
        zapsaný k dnešnímu dni; zpětné zápisy posouvají rekord, ale microwin nedávají.
      </footer>

      <DataDialog open={dataOpen} onOpenChange={setDataOpen} />
    </div>
  );
}
