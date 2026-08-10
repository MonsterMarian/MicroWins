"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FolderKanban,
  Plus,
  Search,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { ProjectDialog } from "./project-dialog";
import { ProjectRow } from "./project-row";
import { TaskRow } from "./task-row";
import { formatDate } from "@/lib/date";
import {
  filterProjects,
  displayPercent,
  filterTasks,
  isTaskDone,
  portfolioStats,
  projectPercent,
  sortProjects,
  todayMovers,
  PROJECT_FILTER_LABEL,
  PROJECT_SORT_LABEL,
  TASK_FILTER_LABEL,
  type ProjectFilter,
  type ProjectSort,
  type TaskFilter,
} from "@/lib/projects";
import { dayRows, streaks } from "@/lib/stats";
import { cn, formatTenth, plural } from "@/lib/utils";

type Tab = "overview" | "projects" | "tasks" | "today";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Přehled" },
  { id: "projects", label: "Projekty" },
  { id: "tasks", label: "Úkoly" },
  { id: "today", label: "Dnes" },
];

export function ProjectsHub() {
  const { state } = useStore();
  const [tab, setTab] = React.useState<Tab>("overview");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const empty = state.projects.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projekty</h1>
          <p className="text-sm text-muted-foreground">
            Velké cíle rozsekané na měřitelné úkoly a denní postup.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus /> Nový projekt
        </Button>
      </header>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {empty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">Zatím žádný projekt</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Projekt drží procenta, deadline a úkoly. Postup se zaznamenává den po dni, takže
              vznikne graf i deník změn.
            </p>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus /> Nový projekt
            </Button>
          </CardContent>
        </Card>
      ) : tab === "overview" ? (
        <OverviewTab onNewProject={() => setDialogOpen(true)} />
      ) : tab === "projects" ? (
        <ProjectsTab onNewProject={() => setDialogOpen(true)} />
      ) : tab === "tasks" ? (
        <TasksTab />
      ) : (
        <TodayTab />
      )}

      <ProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

// --- přehled ----------------------------------------------------------------

function OverviewTab({ onNewProject }: { onNewProject: () => void }) {
  const { state, today } = useStore();
  const p = React.useMemo(() => portfolioStats(state, today), [state, today]);
  const movers = React.useMemo(() => todayMovers(state, today), [state, today]);
  const streak = React.useMemo(() => streaks(state, today), [state, today]);
  const microwinsToday = React.useMemo(
    () => dayRows(state).find((r) => r.date === today)?.count ?? 0,
    [state, today],
  );

  const closest = React.useMemo(
    () =>
      [...state.projects]
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
                <Link key={c.project.id} href={`/projects?id=${c.project.id}`} className="flex flex-col gap-1">
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Microwiny</CardTitle>
              <CardDescription>Druhá polovina aplikace - denní rekordy ve stromu.</CardDescription>
            </div>
            <Link
              href="/tree"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Otevřít strom <ArrowRight className="size-4" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={microwinsToday > 0 ? "solid" : "outline"} className="tabular">
            <Trophy /> dnes {microwinsToday}
          </Badge>
          <Badge variant="outline" className="tabular">
            série {streak.current} {plural(streak.current, "den", "dny", "dní")}
          </Badge>
          <Badge variant="outline" className="tabular">
            celkem {state.microwins.length}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

// --- projekty ---------------------------------------------------------------

function ProjectsTab({ onNewProject }: { onNewProject: () => void }) {
  const { state, today } = useStore();
  const [filter, setFilter] = React.useState<ProjectFilter>("all");
  const [sort, setSort] = React.useState<ProjectSort>("custom");
  const [query, setQuery] = React.useState("");

  const rows = React.useMemo(() => {
    const filtered = filterProjects(state, filter, today).filter((p) =>
      p.name.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return sortProjects(state, filtered, sort);
  }, [state, filter, sort, query, today]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ProjectFilter)}
          aria-label="Filtr projektů"
          className="w-auto"
        >
          {Object.entries(PROJECT_FILTER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectSort)}
          aria-label="Řazení projektů"
          className="w-auto"
        >
          {Object.entries(PROJECT_SORT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat projekt"
            className="pl-8"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nic neodpovídá filtru.</p>
            <Button size="sm" variant="outline" onClick={onNewProject}>
              <Plus /> Nový projekt
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// --- všechny úkoly ----------------------------------------------------------

function TasksTab() {
  const { state, today } = useStore();
  const [filter, setFilter] = React.useState<TaskFilter>("open");
  const [query, setQuery] = React.useState("");

  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.projects
      .filter((p) => p.archivedAt === null)
      .map((project) => ({
        project,
        tasks: filterTasks(
          state,
          state.tasks.filter((t) => t.projectId === project.id),
          filter,
          today,
        ).filter((t) => t.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.tasks.length > 0);
  }, [state, filter, query, today]);

  const total = groups.reduce((s, g) => s + g.tasks.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as TaskFilter)}
          aria-label="Filtr úkolů"
          className="w-auto"
        >
          {Object.entries(TASK_FILTER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          {total} {plural(total, "úkol", "úkoly", "úkolů")}
        </span>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat úkol"
            className="pl-8"
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Žádné úkoly v tomto filtru.
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.project.id} className="overflow-hidden">
            <Link
              href={`/projects?id=${g.project.id}`}
              className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium hover:bg-accent/50"
            >
              <EntityIcon icon={g.project.icon} size="sm" />
              {g.project.name}
              <span className="tabular ml-auto text-xs text-muted-foreground">
                {displayPercent(projectPercent(state, g.project.id))} %
              </span>
            </Link>
            <div className="divide-y">
              {g.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

// --- dnes -------------------------------------------------------------------

function TodayTab() {
  const { state, today } = useStore();
  const movers = React.useMemo(() => todayMovers(state, today), [state, today]);
  const microwins = React.useMemo(
    () => dayRows(state).find((r) => r.date === today)?.items ?? [],
    [state, today],
  );

  const due = state.tasks.filter((t) => t.dueDate === today && !isTaskDone(state, t));
  const overdue = state.tasks.filter(
    (t) => t.dueDate !== null && t.dueDate < today && !isTaskDone(state, t),
  );
  const projectName = (id: string) => state.projects.find((p) => p.id === id)?.name;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{formatDate(today)}</CardTitle>
          <CardDescription>Co má termín dnes a co dnes narostlo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline" className="tabular">
            <CalendarClock /> {due.length} s termínem dnes
          </Badge>
          <Badge variant={overdue.length ? "default" : "outline"} className="tabular">
            <AlertTriangle /> {overdue.length} po termínu
          </Badge>
          <Badge variant={microwins.length ? "solid" : "outline"} className="tabular">
            <Trophy /> {microwins.length} microwinů
          </Badge>
        </CardContent>
      </Card>

      {overdue.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Po termínu</CardTitle>
          </CardHeader>
          <div className="divide-y border-t">
            {overdue.map((t) => (
              <TaskRow key={t.id} task={t} showProject={projectName(t.projectId)} />
            ))}
          </div>
        </Card>
      ) : null}

      {due.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Termín dnes</CardTitle>
          </CardHeader>
          <div className="divide-y border-t">
            {due.map((t) => (
              <TaskRow key={t.id} task={t} showProject={projectName(t.projectId)} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Dnešní přírůstky</CardTitle>
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

      {microwins.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dnešní microwiny</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {microwins.map((item) => (
              <div key={item.microwin.id} className="flex items-center gap-2 text-sm">
                <Trophy className="size-4 text-win" />
                <span className="font-medium">{item.text}</span>
                <span className="text-xs text-muted-foreground">{item.path}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
