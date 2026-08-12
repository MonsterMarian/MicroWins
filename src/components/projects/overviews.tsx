"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Flag,
  FolderKanban,
  Flame,
  Plus,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { Ring } from "@/components/charts/ring";
import { DailyBarChart } from "@/components/charts/bar-chart";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { diffDays, formatDate, formatDateRelative } from "@/lib/date";
import {
  displayPercent,
  isTaskDone,
  pace,
  portfolioActivity,
  portfolioStats,
  projectPercent,
  projectStats,
  todayMovers,
  PACE_LABEL,
  type ProjectStats,
} from "@/lib/projects";
import { streaks } from "@/lib/stats";
import type { ISODate, MicroWinsState, Project } from "@/lib/types";
import { cn, formatTenth, plural } from "@/lib/utils";
import { PACE_TONE } from "./project-row";

/**
 * Šest podob úvodní obrazovky.
 *
 * Data jsou pokaždé stejná, liší se otázka, na kterou karta odpovídá:
 * „jak si stojím" (Přehled), „co teď" (Na řadě), „co všechno mám"
 * (Nástěnka), „co kdy hoří" (Osa), „makám?" (Tep), „čísla" (Tabulka).
 * Přepíná se v Nastavení, protože správná odpověď je u každého jiná.
 */
export function Overview({ onNewProject }: { onNewProject: () => void }) {
  const { overview } = usePrefs();

  switch (overview) {
    case "focus":
      return <FocusOverview />;
    case "board":
      return <BoardOverview />;
    case "timeline":
      return <TimelineOverview />;
    case "pulse":
      return <PulseOverview />;
    case "table":
      return <TableOverview />;
    default:
      return <ClassicOverview onNewProject={onNewProject} />;
  }
}

/** Živé projekty se statistikou, seřazené vlastním pořadím. */
function useLiveProjects(): { project: Project; stats: ProjectStats }[] {
  const { state, today } = useStore();
  return React.useMemo(
    () =>
      state.projects
        .filter((p) => p.archivedAt === null)
        .sort((a, b) => a.order - b.order)
        .map((project) => ({ project, stats: projectStats(state, project.id, today)! }))
        .filter((x) => x.stats),
    [state, today],
  );
}

// --- 1. Přehled -------------------------------------------------------------

function ClassicOverview({ onNewProject }: { onNewProject: () => void }) {
  const { state, today } = useStore();
  const p = React.useMemo(() => portfolioStats(state, today), [state, today]);
  const movers = React.useMemo(() => todayMovers(state, today), [state, today]);

  const closest = React.useMemo(
    () =>
      state.projects
        .filter((x) => x.archivedAt === null)
        .map((x) => ({ project: x, percent: projectPercent(state, x.id) }))
        .filter((x) => x.percent < 100)
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 3),
    [state],
  );

  const tiles = [
    {
      icon: FolderKanban,
      label: "Aktivní projekty",
      value: String(p.activeProjects),
      hint: `${p.doneProjects} hotových z ${p.projects}`,
    },
    {
      icon: TrendingUp,
      label: "Průměrný postup",
      value: `${displayPercent(p.avgPercent)} %`,
      hint: p.todayDelta > 0 ? `dnes +${formatTenth(p.todayDelta)} b.` : "dnes beze změny",
      accent: p.todayDelta > 0,
    },
    {
      icon: CheckCircle2,
      label: "Hotové úkoly",
      value: `${p.tasksDone} / ${p.tasksTotal}`,
      hint: `${p.dueToday} s termínem dnes`,
    },
    {
      icon: AlertTriangle,
      label: "Po termínu",
      value: String(p.overdue),
      hint: p.overdue === 0 ? "nic nehoří" : "úkolů ve skluzu",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value, hint, accent }) => (
          <Card key={label} className={cn("p-4", accent && "border-progress/40 bg-progress-muted/30")}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className={cn("size-3.5", accent && "text-progress")} />
              {label}
            </div>
            <p className="tabular mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dnes se pohnulo</CardTitle>
            <CardDescription>Projekty, kterým dnes narostla procenta.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {movers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Dnes zatím nic. Otevři projekt a posuň libovolný úkol.
              </p>
            ) : (
              movers.map((m) => (
                <Link
                  key={m.project.id}
                  href={`/projects?id=${m.project.id}`}
                  className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent/60"
                >
                  <EntityIcon icon={m.project.icon} size="lg" />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.project.name}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {displayPercent(m.percent)} %
                  </span>
                  <Badge variant="outline" className="tabular border-progress/40 text-progress">
                    +{formatTenth(m.delta)} b.
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nejblíž cíli</CardTitle>
            <CardDescription>Co stačí dotlačit do stovky.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {closest.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-muted-foreground">Všechno hotové, nebo zatím nic.</p>
                <Button size="sm" variant="outline" onClick={onNewProject}>
                  <Plus /> Nový projekt
                </Button>
              </div>
            ) : (
              closest.map((c) => (
                <Link
                  key={c.project.id}
                  href={`/projects?id=${c.project.id}`}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-center gap-2">
                    <EntityIcon icon={c.project.icon} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">{c.project.name}</span>
                    <span className="tabular text-sm font-medium">{displayPercent(c.percent)} %</span>
                  </div>
                  <ProgressBar value={c.percent} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- 2. Na řadě -------------------------------------------------------------

/**
 * Jeden projekt velký, zbytek drobně pod ním.
 *
 * Na řadě je ten nejnaléhavější: po termínu, pak ve skluzu, pak podle toho,
 * kolik zbývá dní. Hotové projekty se přeskakují - dotlačený projekt už
 * pozornost nepotřebuje.
 */
function FocusOverview() {
  const projects = useLiveProjects();
  const { state, today } = useStore();

  const ranked = React.useMemo(() => {
    const urgency = ({ stats }: { stats: ProjectStats }) => {
      if (stats.percent >= 100) return 1e9;
      if (stats.overdue) return -1e6 + (stats.daysLeft ?? 0);
      return stats.daysLeft ?? 5000;
    };
    return [...projects].sort((a, b) => urgency(a) - urgency(b));
  }, [projects]);

  if (ranked.length === 0) return <Empty />;

  const [lead, ...rest] = ranked;
  const status = pace(lead.stats);
  const tasks = state.tasks
    .filter((t) => t.projectId === lead.project.id && !isTaskDone(state, t))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-xl">
              <EntityIcon icon={lead.project.icon} size="lg" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Na řadě</p>
              <Link
                href={`/projects?id=${lead.project.id}`}
                className="block truncate text-lg font-semibold tracking-tight hover:underline"
              >
                {lead.project.name}
              </Link>
            </div>
            <span className="tabular text-3xl font-semibold tracking-tight">
              {displayPercent(lead.stats.percent)}
              <span className="ml-0.5 text-base text-muted-foreground">%</span>
            </span>
          </div>

          <ProgressBar value={lead.stats.percent} size="xl" tone={PACE_TONE[status]} />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{PACE_LABEL[status]}</Badge>
            {lead.stats.daysLeft !== null ? (
              <Badge variant="outline" className="tabular">
                <CalendarClock />
                {lead.stats.daysLeft >= 0
                  ? `zbývá ${lead.stats.daysLeft} ${plural(lead.stats.daysLeft, "den", "dny", "dní")}`
                  : `${-lead.stats.daysLeft} ${plural(-lead.stats.daysLeft, "den", "dny", "dní")} po termínu`}
              </Badge>
            ) : null}
            {lead.stats.targetPerDay !== null ? (
              <Badge variant="outline" className="tabular">
                {formatTenth(lead.stats.targetPerDay)} % / den
              </Badge>
            ) : null}
          </div>

          {tasks.length > 0 ? (
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Co zbývá
              </p>
              {tasks.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks?id=${t.id}`}
                  className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/60"
                >
                  <EntityIcon icon={t.icon} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.dueDate ? (
                    <span
                      className={cn(
                        "tabular shrink-0 text-xs",
                        t.dueDate < today ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {formatDateRelative(t.dueDate, today)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {rest.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Potom</CardTitle>
          </CardHeader>
          <div className="divide-y border-t">
            {rest.map(({ project, stats }) => (
              <Link
                key={project.id}
                href={`/projects?id=${project.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50"
              >
                <EntityIcon icon={project.icon} size="lg" />
                <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                <span className="block w-16 shrink-0">
                  <ProgressBar value={stats.percent} size="sm" quiet />
                </span>
                <span className="tabular w-10 shrink-0 text-right text-xs text-muted-foreground">
                  {displayPercent(stats.percent)} %
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// --- 3. Nástěnka ------------------------------------------------------------

/** Dlaždice s kroužkem. Nejrychlejší odpověď na „co všechno mám rozdělané". */
function BoardOverview() {
  const projects = useLiveProjects();
  if (projects.length === 0) return <Empty />;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {projects.map(({ project, stats }) => {
        const status = pace(stats);
        return (
          <Link key={project.id} href={`/projects?id=${project.id}`}>
            <Card className="flex h-full flex-col items-center gap-2 p-4 transition-colors hover:bg-accent/40">
              <Ring
                value={stats.percent}
                size={84}
                stroke={8}
                tone={status === "behind" || status === "late" ? "win" : "progress"}
              >
                <span className="tabular text-base font-semibold">
                  {displayPercent(stats.percent)}
                </span>
              </Ring>
              <span className="flex items-center gap-1.5 text-center text-sm">
                <EntityIcon icon={project.icon} size="sm" />
                <span className="line-clamp-2 min-w-0">{project.name}</span>
              </span>
              <span
                className={cn(
                  "tabular text-xs",
                  stats.deltaToday > 0.05 ? "text-progress" : "text-muted-foreground",
                )}
              >
                {stats.deltaToday > 0.05
                  ? `+${formatTenth(stats.deltaToday)} b. dnes`
                  : stats.daysLeft !== null
                    ? stats.daysLeft >= 0
                      ? `zbývá ${stats.daysLeft} dní`
                      : `${-stats.daysLeft} dní po termínu`
                    : "bez deadlinu"}
              </span>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

// --- 4. Osa -----------------------------------------------------------------

interface TimelineItem {
  key: string;
  date: ISODate;
  title: string;
  icon: string;
  href: string;
  kind: "deadline" | "milestone" | "task";
  done: boolean;
}

/**
 * Termíny a milníky v pořadí, jak přijdou. Jediná karta, která míchá projekty,
 * úkoly i milníky dohromady - kalendář se neptá, komu co patří.
 */
function TimelineOverview() {
  const { state, today } = useStore();

  const items = React.useMemo<TimelineItem[]>(() => {
    const live = state.projects.filter((p) => p.archivedAt === null);
    const ids = new Set(live.map((p) => p.id));
    const out: TimelineItem[] = [];

    for (const p of live) {
      if (p.deadline) {
        out.push({
          key: `p${p.id}`,
          date: p.deadline,
          title: p.name,
          icon: p.icon,
          href: `/projects?id=${p.id}`,
          kind: "deadline",
          done: projectPercent(state, p.id) >= 100,
        });
      }
    }
    for (const m of state.milestones) {
      if (!m.date || !ids.has(m.projectId)) continue;
      out.push({
        key: `m${m.id}`,
        date: m.date,
        title: m.name,
        icon: "🚩",
        href: `/projects?id=${m.projectId}`,
        kind: "milestone",
        done: m.doneAt !== null,
      });
    }
    for (const t of state.tasks) {
      if (!t.dueDate || !ids.has(t.projectId)) continue;
      out.push({
        key: `t${t.id}`,
        date: t.dueDate,
        title: t.name,
        icon: t.icon,
        href: `/tasks?id=${t.id}`,
        kind: "task",
        done: isTaskDone(state, t),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [state]);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nic nemá termín. Osa se naplní, až projekt dostane deadline nebo úkol termín.
        </CardContent>
      </Card>
    );
  }

  const KIND_LABEL = { deadline: "deadline", milestone: "milník", task: "úkol" } as const;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Co kdy přijde</CardTitle>
        <CardDescription>Deadliny projektů, milníky a termíny úkolů v jedné řadě.</CardDescription>
      </CardHeader>
      <ul className="divide-y border-t">
        {items.map((item) => {
          const days = diffDays(today, item.date);
          const overdue = days < 0 && !item.done;
          return (
            <li key={item.key}>
              <Link href={item.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
                <span
                  className={cn(
                    "grid w-14 shrink-0 place-items-center rounded-lg border py-1 text-center",
                    overdue && "border-destructive/40 bg-destructive/10",
                    days === 0 && !item.done && "border-progress/40 bg-progress-muted/30",
                  )}
                >
                  <span className="tabular text-sm font-semibold leading-none">
                    {days === 0 ? "dnes" : days > 0 ? `+${days}` : days}
                  </span>
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    {days === 0 ? "" : plural(Math.abs(days), "den", "dny", "dní")}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 truncate text-sm",
                      item.done && "text-muted-foreground line-through",
                    )}
                  >
                    <EntityIcon icon={item.icon} size="sm" />
                    {item.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {KIND_LABEL[item.kind]} · {formatDate(item.date)}
                  </span>
                </span>

                {item.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-progress" />
                ) : overdue ? (
                  <AlertTriangle className="size-4 shrink-0 text-destructive" />
                ) : item.kind === "milestone" ? (
                  <Flag className="size-4 shrink-0 text-muted-foreground/50" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- 5. Tep -----------------------------------------------------------------

/** Kolik práce se skutečně odvedlo. Jediná karta, která měří tempo, ne stav. */
function PulseOverview() {
  const { state, today } = useStore();
  const activity = React.useMemo(() => portfolioActivity(state, 30, today), [state, today]);
  const streak = React.useMemo(() => streaks(state, today), [state, today]);
  const movers = React.useMemo(() => todayMovers(state, today), [state, today]);

  const total = activity.reduce((s, a) => s + a.gain, 0);
  const activeDays = activity.filter((a) => a.gain > 0).length;
  const best = activity.reduce((m, a) => (a.gain > m.gain ? a : m), activity[0]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Za 30 dní" value={`${formatTenth(total)} b.`} hint="součet přírůstků" />
        <Stat
          label="Dní s prací"
          value={`${activeDays} / 30`}
          hint={activeDays > 0 ? `nejlepší ${formatTenth(best.gain)} b.` : "zatím nic"}
        />
        <Stat
          label="Série microwinů"
          value={String(streak.current)}
          hint={plural(streak.current, "den", "dny", "dní")}
          icon={Flame}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Denní přírůstky</CardTitle>
          <CardDescription>
            Kolik procentních bodů celkem přibylo napříč projekty. Klesající dny se nepočítají.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DailyBarChart
            points={activity.map((a) => ({ date: a.date, value: a.gain }))}
            unit=" b."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dnes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {movers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Dnes se zatím nic nepohnulo.</p>
          ) : (
            movers.map((m) => (
              <Link
                key={m.project.id}
                href={`/projects?id=${m.project.id}`}
                className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent/60"
              >
                <EntityIcon icon={m.project.icon} size="lg" />
                <span className="min-w-0 flex-1 truncate text-sm">{m.project.name}</span>
                <Badge variant="outline" className="tabular border-progress/40 text-progress">
                  +{formatTenth(m.delta)} b.
                </Badge>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon?: React.ElementType;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </div>
      <p className="tabular mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

// --- 6. Tabulka -------------------------------------------------------------

/** Všechna čísla pod sebou. Na širokém okně se dá číst po sloupcích. */
function TableOverview() {
  const projects = useLiveProjects();
  if (projects.length === 0) return <Empty />;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scroll-quiet">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Projekt</th>
              <th className="px-2 py-2 text-right font-medium">Postup</th>
              <th className="px-2 py-2 text-right font-medium">Dnes</th>
              <th className="px-2 py-2 text-right font-medium">Úkoly</th>
              <th className="px-2 py-2 text-right font-medium">Zbývá</th>
              <th className="px-4 py-2 text-right font-medium">Tempo</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {projects.map(({ project, stats }) => (
              <tr key={project.id} className="hover:bg-accent/40">
                <td className="px-4 py-2">
                  <Link
                    href={`/projects?id=${project.id}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <EntityIcon icon={project.icon} size="sm" />
                    <span className="max-w-40 truncate">{project.name}</span>
                  </Link>
                </td>
                <td className="tabular px-2 py-2 text-right font-medium">
                  {displayPercent(stats.percent)} %
                </td>
                <td
                  className={cn(
                    "tabular px-2 py-2 text-right",
                    stats.deltaToday > 0.05 ? "text-progress" : "text-muted-foreground",
                  )}
                >
                  {stats.deltaToday > 0.05 ? `+${formatTenth(stats.deltaToday)}` : "—"}
                </td>
                <td className="tabular px-2 py-2 text-right text-muted-foreground">
                  {stats.tasksDone} / {stats.tasksTotal}
                </td>
                <td
                  className={cn(
                    "tabular px-2 py-2 text-right",
                    stats.overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {stats.daysLeft === null ? "—" : stats.daysLeft}
                </td>
                <td className="tabular px-4 py-2 text-right text-muted-foreground">
                  {stats.targetPerDay === null ? "—" : `${formatTenth(stats.targetPerDay)} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Empty() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Všechny projekty jsou v archivu.
      </CardContent>
    </Card>
  );
}
