"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Archive,
  ArrowDownUp,
  CalendarDays,
  ChartLine,
  CheckSquare,
  Clock,
  Flag,
  Pencil,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Fab } from "@/components/ui/fab";
import { Input, Select, Textarea } from "@/components/ui/input";
import { AnimatedPercent, DeltaBubble, ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { useStore } from "@/components/providers/store-provider";
import { useGoUp } from "@/components/providers/use-app-back";
import { MilestonesDialog } from "./milestones-dialog";
import { MilestonesSection } from "./milestones-section";
import { ProjectDialog } from "./project-dialog";
import { TaskDialog } from "./task-dialog";
import { TaskRow } from "./task-row";
import { PACE_TONE } from "./project-row";
import { formatDate } from "@/lib/date";
import {
  displayPercent,
  pace,
  projectById,
  projectStats,
  taskPercent,
  tasksOfProject,
  PACE_LABEL,
} from "@/lib/projects";
import { cn, formatTenth, plural } from "@/lib/utils";

type TaskSort = "custom" | "name" | "progress" | "due";

const TASK_SORT_LABEL: Record<TaskSort, string> = {
  custom: "Vlastní pořadí",
  name: "Podle názvu",
  progress: "Podle postupu",
  due: "Podle termínu",
};

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { state, today, hydrated, updateProject, deleteProject, setProjectArchived, reorderTasks } =
    useStore();
  const router = useRouter();
  const goUp = useGoUp();
  const [editOpen, setEditOpen] = React.useState(false);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [milestonesOpen, setMilestonesOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const [sort, setSort] = React.useState<TaskSort>("custom");
  const [description, setDescription] = React.useState("");

  const project = projectById(state, projectId);
  const stats = projectStats(state, projectId, today);

  React.useEffect(() => {
    if (project) setDescription(project.description);
  }, [project?.id, project?.description]);

  if (!hydrated) return <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />;

  if (!project || !stats) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium">Projekt neexistuje</p>
          <Link href="/?tab=projects" className="text-sm text-muted-foreground underline">
            Zpět na seznam
          </Link>
        </CardContent>
      </Card>
    );
  }

  const tasks = tasksOfProject(state, projectId);
  const sorted = [...tasks].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name, "cs");
      case "progress":
        return taskPercent(state, b) - taskPercent(state, a);
      case "due":
        return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
      default:
        return a.order - b.order;
    }
  });

  const done = stats.percent >= 100;
  const status = pace(stats);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zpět na projekty"
          onClick={() => goUp("/?tab=projects")}
        >
          <ArrowLeft />
        </Button>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-lg">
          <EntityIcon icon={project.icon} size="lg" />
        </span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
          {project.name}
        </h1>
        <Link
          href={`/projects/stats?id=${project.id}`}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="Statistiky projektu"
          title="Statistiky projektu"
        >
          <ChartLine />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Milníky"
          title="Milníky"
          onClick={() => setMilestonesOpen(true)}
        >
          <Flag />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Upravit" onClick={() => setEditOpen(true)}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={project.archivedAt ? "Vrátit z archivu" : "Archivovat"}
          title={project.archivedAt ? "Vrátit z archivu" : "Archivovat"}
          onClick={() => setConfirmArchive(true)}
        >
          <Archive />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Smazat"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 />
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="relative flex items-end justify-between gap-3">
            <DeltaBubble value={stats.percent} format={formatTenth} className="left-10" />
            <p className="text-4xl font-semibold leading-none tracking-tight">
              <AnimatedPercent value={stats.percent} format={displayPercent} suffix="" />
              <span className="ml-0.5 text-xl text-muted-foreground">%</span>
            </p>
            <span
              className={cn(
                "tabular text-sm",
                stats.deltaToday > 0.05 ? "text-progress" : "text-muted-foreground",
              )}
            >
              {stats.deltaToday > 0.05 ? "+" : ""}
              {formatTenth(stats.deltaToday)} % dnes
            </span>
          </div>

          <ProgressBar value={stats.percent} size="xl" tone={PACE_TONE[status]} />

          {status !== "none" ? (
            <div className="-mt-1 flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status === "late"
                    ? "bg-destructive"
                    : status === "behind"
                      ? "bg-win"
                      : "bg-progress",
                )}
              />
              <span
                className={cn(
                  status === "late"
                    ? "text-destructive"
                    : status === "behind"
                      ? "text-win-muted-foreground"
                      : "text-progress-muted-foreground",
                )}
              >
                {PACE_LABEL[status]}
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="rounded-md border px-2 py-1 text-xs">
              {formatDate(project.startDate)}
            </span>
            <span className="text-muted-foreground">-</span>
            {project.deadline ? (
              <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                {formatDate(project.deadline)}
                <button
                  type="button"
                  aria-label="Zrušit deadline"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => updateProject(project.id, { deadline: null })}
                >
                  ×
                </button>
              </span>
            ) : (
              <label className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                Bez deadlinu
                <Input
                  type="date"
                  className="h-6 w-32 border-0 bg-transparent p-0 text-xs shadow-none"
                  min={project.startDate}
                  onChange={(e) =>
                    e.target.value && updateProject(project.id, { deadline: e.target.value })
                  }
                  aria-label="Nastavit deadline"
                />
              </label>
            )}
          </div>

          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <dt className="text-muted-foreground">Zbývá dní:</dt>
              <dd className={cn("tabular font-medium", stats.overdue && "text-destructive")}>
                {stats.percent >= 100 || stats.daysLeft === null
                  ? "-"
                  : stats.daysLeft >= 0
                    ? stats.daysLeft
                    : `${-stats.daysLeft} po termínu`}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <Target className="size-4 text-muted-foreground" />
              <dt className="text-muted-foreground">Tempo:</dt>
              <dd className="tabular font-medium">
                {stats.targetPerDay === null
                  ? "-"
                  : `${formatTenth(stats.targetPerDay)} % / den`}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <CheckSquare className="size-4 text-muted-foreground" />
              <dt className="text-muted-foreground">Uplynulo:</dt>
              <dd className="tabular font-medium">
                {stats.percent >= 100
                  ? "-"
                  : `${stats.daysElapsed} ${plural(stats.daysElapsed, "den", "dny", "dní")}`}
              </dd>
            </div>
          </dl>

          <Textarea
            value={description}
            placeholder="Popis projektu"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => updateProject(project.id, { description })}
            className="min-h-16 bg-muted/40"
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Úkoly</CardTitle>
            {tasks.length > 0 ? (
              <Badge variant={done ? "solid" : "default"} className="tabular">
                {stats.tasksDone} z {stats.tasksTotal}
              </Badge>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <ArrowDownUp className="size-3.5 text-muted-foreground" />
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as TaskSort)}
                aria-label="Řazení úkolů"
                className="h-8 w-auto text-xs"
              >
                {Object.entries(TASK_SORT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardHeader>

        {tasks.length === 0 ? (
          <CardContent className="pb-6 text-center text-sm text-muted-foreground">
            Zatím žádný úkol. Přidej první měřitelný krok.
          </CardContent>
        ) : (
          <SortableList
            ids={sorted.map((t) => t.id)}
            onReorder={reorderTasks}
            disabled={sort !== "custom"}
            className="divide-y border-t"
          >
            {sorted.map((task) => (
              <SortableItem key={task.id} id={task.id}>
                <TaskRow task={task} />
              </SortableItem>
            ))}
          </SortableList>
        )}

        {tasks.length > 1 ? (
          <p className="border-t p-3 text-xs text-muted-foreground">
            {sort === "custom"
              ? "Podrž prst na úkolu a přetáhni ho."
              : "Přetahovat jde ve vlastním pořadí."}
          </p>
        ) : null}
      </Card>

      <MilestonesSection projectId={project.id} />

      {/* Přidávání úkolů je hlavní akce téhle obrazovky - patří pod palec,
          ne až na konec seznamu, kam se u dlouhého projektu musí scrollovat. */}
      <Fab onClick={() => setTaskOpen(true)} aria-label="Nový úkol">
        <Plus /> Nový úkol
      </Fab>

      <ProjectDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
      <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} projectId={project.id} />
      <MilestonesDialog
        open={milestonesOpen}
        onOpenChange={setMilestonesOpen}
        projectId={project.id}
      />

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Smazat projekt "${project.name}"?`}
        description="Zmizí i všechny úkoly, milníky a historie postupu."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteProject(project.id);
                router.replace("/?tab=projects");
              }}
            >
              <Trash2 /> Smazat
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {tasks.length} {plural(tasks.length, "úkol", "úkoly", "úkolů")} a{" "}
          {state.snapshots.filter((s) => s.projectId === project.id).length} denních otisků.
        </p>
      </Dialog>

      <Dialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={project.archivedAt ? "Vrátit projekt z archivu?" : "Archivovat projekt?"}
        description={
          project.archivedAt
            ? "Projekt se znovu zařadí mezi aktivní a bude se započítávat do přehledů."
            : "Projekt zmizí z hlavní obrazovky, ale kdykoliv se k němu můžeš vrátit přes filtr."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
              Zrušit
            </Button>
            <Button
              onClick={() => {
                setProjectArchived(project.id, project.archivedAt === null);
                setConfirmArchive(false);
              }}
            >
              {project.archivedAt ? "Vrátit" : "Archivovat"}
            </Button>
          </>
        }
      />
    </div>
  );
}
