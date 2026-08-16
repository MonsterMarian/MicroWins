"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Flag,
  Minus,
  Pencil,
  Plus,
  Scale,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Fab } from "@/components/ui/fab";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { AnimatedPercent, DeltaBubble, ProgressBar, Slider } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { useStore } from "@/components/providers/store-provider";
import { useGoUp } from "@/components/providers/use-app-back";
import { DoneButton } from "./done-button";
import { TaskDialog } from "./task-dialog";
import { TaskRow } from "./task-row";
import { formatDate } from "@/lib/date";
import {
  displayPercent,
  isBinaryTask,
  isTaskDone,
  milestonesOfProject,
  projectById,
  subtaskCounts,
  subtasksOf,
  taskById,
  taskDeltaToday,
  taskPercent,
} from "@/lib/projects";
import { tapFeedback, winFeedback } from "@/lib/native";
import { cn, formatNumber, formatTenth, parseWhole, plural } from "@/lib/utils";

export function TaskDetail({ taskId }: { taskId: string }) {
  const {
    state,
    today,
    hydrated,
    updateTask,
    setTaskCurrent,
    adjustTask,
    toggleTaskDone,
    deleteTask,
    reorderTasks,
  } = useStore();
  const router = useRouter();
  const goUp = useGoUp();
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [editOpen, setEditOpen] = React.useState(false);
  const [subtaskOpen, setSubtaskOpen] = React.useState(false);
  const [stepOpen, setStepOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [manual, setManual] = React.useState("");

  const task = taskById(state, taskId);

  React.useEffect(() => {
    if (task) {
      setDescription(task.description);
      setManual(String(task.current));
    }
  }, [task?.id, task?.description, task?.current]);

  if (!hydrated) return <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />;

  if (!task) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium">Úkol neexistuje</p>
          <Link href="/" className="text-sm text-muted-foreground underline">
            Zpět na seznam
          </Link>
        </CardContent>
      </Card>
    );
  }

  const project = projectById(state, task.projectId);
  const children = subtasksOf(state, task.id);
  const percent = taskPercent(state, task);
  const done = isTaskDone(state, task);
  const milestones = project ? milestonesOfProject(state, project.id) : [];
  /** Postup se počítá z podúkolů - vlastní hodnota úkolu se pak neuplatní. */
  const controlled = children.length > 0;
  const counts = subtaskCounts(state, task.id);
  const binary = isBinaryTask(state, task);
  const deltaToday = taskDeltaToday(state, task, today);
  /* O úroveň výš, ne zpět v historii: z podúkolu na úkol, z úkolu na projekt.
     Stejně se chová strom microwinů. */
  const parentHref = task.parentId
    ? `/tasks?id=${task.parentId}`
    : `/projects?id=${task.projectId}`;

  /* Krok hodnoty i s hmatovou odezvou. Doražení do cíle cvakne jinak než
     obyčejný krok - je to jediná chvíle, kdy se dá bez dívání poznat, že je
     úkol hotový. */
  const bump = (delta: number) => {
    adjustTask(task.id, delta);
    const reached = task.current + delta >= task.target;
    void (reached && delta > 0 ? winFeedback() : tapFeedback());
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={task.parentId ? "Zpět na nadřazený úkol" : "Zpět na projekt"}
          onClick={() => goUp(parentHref)}
        >
          <ArrowLeft />
        </Button>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-lg">
          <EntityIcon icon={task.icon} size="lg" />
        </span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{task.name}</h1>
        <Button variant="ghost" size="icon" aria-label="Upravit" onClick={() => setEditOpen(true)}>
          <Pencil />
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
          {binary ? (
            /* Cíl 1 bez podúkolů: není co posouvat, buď je hotovo, nebo není. */
            <DoneButton
              done={done}
              onToggle={() => {
                toggleTaskDone(task.id);
                void (done ? tapFeedback() : winFeedback());
              }}
            />
          ) : (
            <>
              <div className="relative flex flex-col items-center gap-1">
                {/* U úkolu hlásí bublina skutečný přírůstek, ne procenta:
                    hodina ze tří set je "+1 H", kdežto "+0,3 %" nikomu nic
                    neřekne. Postup z podúkolů žádnou vlastní hodnotu nemá,
                    tam zbývají procenta. */}
                {controlled ? (
                  <DeltaBubble value={percent} format={formatTenth} className="-top-1" />
                ) : (
                  <DeltaBubble
                    value={task.current}
                    format={(n) => `${formatNumber(n)}${task.unit ? ` ${task.unit}` : ""}`}
                    className="-top-1"
                  />
                )}
                <AnimatedPercent
                  value={percent}
                  format={displayPercent}
                  className={cn(
                    "text-4xl font-semibold leading-none tracking-tight",
                    done ? "text-progress" : "text-progress-muted-foreground",
                  )}
                />
                <p className="tabular text-sm text-muted-foreground">
                  {controlled ? (
                    <>
                      {counts.done} / {counts.total}{" "}
                      {plural(counts.total, "podúkol", "podúkoly", "podúkolů")} hotovo
                    </>
                  ) : (
                    <>
                      {formatNumber(task.current)} / {formatNumber(task.target)}
                      {task.unit ? ` ${task.unit}` : ""}
                    </>
                  )}
                </p>
                {/* Stejný údaj, jaký má u velkého čísla projekt: o kolik
                    procentních bodů se úkol dnes pohnul. */}
                <span
                  className={cn(
                    "tabular text-sm",
                    deltaToday > 0.05
                      ? "text-progress"
                      : deltaToday < -0.05
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {deltaToday > 0.05 ? "+" : ""}
                  {formatTenth(deltaToday)} % dnes
                </span>
              </div>

              {controlled ? (
                /* Posuvník by tu ukazoval vlastní hodnotu úkolu, kterou nikdo
                   nepoužívá - u 66 % z podúkolů byl prázdný. Místo něj pruh
                   se skutečným postupem. */
                <>
                  <ProgressBar value={percent} size="xl" />
                  <p className="text-center text-xs text-muted-foreground">
                    Postup se počítá z podúkolů, ručně se posouvat nedá.
                  </p>
                </>
              ) : (
                <>
                  <Slider
                    value={task.current}
                    max={task.target}
                    step={1}
                    aria-label="Postup úkolu"
                    onChange={(v) => setTaskCurrent(task.id, v)}
                  />

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 rounded-lg transition-transform active:scale-90"
                        aria-label={`Ubrat ${task.step}`}
                        onClick={() => bump(-task.step)}
                      >
                        <Minus />
                      </Button>
                      <span className="tabular w-12 text-center text-xs text-muted-foreground">
                        {formatNumber(task.step)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 rounded-lg transition-transform active:scale-90"
                        aria-label={`Přidat ${task.step}`}
                        onClick={() => bump(task.step)}
                      >
                        <Plus />
                      </Button>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Zadat hodnotu ručně"
                      onClick={() => setStepOpen(true)}
                    >
                      <SlidersHorizontal />
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 p-5 text-left"
          aria-expanded={settingsOpen}
        >
          <span className="text-sm font-semibold tracking-tight">Nastavení úkolu</span>
          <ChevronDown className={cn("size-4 transition-transform", settingsOpen && "rotate-180")} />
        </button>

        {settingsOpen ? (
          <CardContent className="flex flex-col gap-4">
            {/* Odkaz na projekt tu byl zbytečný - vede tam šipka v hlavičce. */}
            <Row icon={Flag} label="Milník">
              <Select
                value={task.milestoneId ?? ""}
                onChange={(e) => updateTask(task.id, { milestoneId: e.target.value || null })}
                aria-label="Milník"
                className="h-8 w-auto text-xs"
              >
                <option value="">Bez milníku</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Row>

            <Row icon={Flag} label="Termín">
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={task.dueDate ?? ""}
                  onChange={(e) => updateTask(task.id, { dueDate: e.target.value || null })}
                  className="h-8 w-40 text-xs"
                  aria-label="Termín úkolu"
                />
                {task.dueDate ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Zrušit termín"
                    onClick={() => updateTask(task.id, { dueDate: null })}
                  >
                    ×
                  </Button>
                ) : null}
              </div>
            </Row>

            <Row icon={Scale} label="Váha">
              <div className="flex items-center gap-2">
                <Input
                  value={String(task.weight)}
                  inputMode="numeric"
                  onChange={(e) => {
                    const v = parseWhole(e.target.value);
                    if (Number.isFinite(v) && v >= 0) updateTask(task.id, { weight: v });
                  }}
                  className="h-8 w-16 text-xs"
                  aria-label="Jak moc se počítá do projektu"
                />
                <span className="text-xs text-muted-foreground">
                  {task.weight === 0
                    ? "nepočítá se do procent"
                    : task.weight === 1
                      ? "jako ostatní úkoly"
                      : `${task.weight}× víc než běžný úkol`}
                </span>
              </div>
            </Row>

            <Textarea
              value={description}
              placeholder="Popis úkolu"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => updateTask(task.id, { description })}
              className="min-h-16 bg-muted/40"
            />
          </CardContent>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-5 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Podúkoly</h2>
            {children.length > 0 ? (
              <Badge variant="outline" className="tabular">
                {counts.done} z {counts.total}
              </Badge>
            ) : null}
          </div>
        </div>

        {children.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            {binary
              ? "Bez podúkolů. Úkol se zatím jen odškrtává - první podúkol z něj udělá skládaný postup."
              : "Bez podúkolů. Postup se pak řídí posuvníkem výš."}
          </p>
        ) : (
          <SortableList
            ids={children.map((c) => c.id)}
            onReorder={reorderTasks}
            className="divide-y border-t"
          >
            {children.map((child) => (
              <SortableItem key={child.id} id={child.id}>
                <TaskRow task={child} />
              </SortableItem>
            ))}
          </SortableList>
        )}
      </Card>

      {task.dueDate ? (
        <p className="text-xs text-muted-foreground">Termín: {formatDate(task.dueDate)}</p>
      ) : null}

      <Fab onClick={() => setSubtaskOpen(true)} aria-label="Nový podúkol">
        <Plus /> Podúkol
      </Fab>

      <TaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={task.projectId}
        task={task}
      />
      <TaskDialog
        open={subtaskOpen}
        onOpenChange={setSubtaskOpen}
        projectId={task.projectId}
        parentId={task.id}
      />

      <Dialog
        open={stepOpen}
        onOpenChange={setStepOpen}
        title="Zadat hodnotu"
        description="Přesné číslo bez posuvníku. Úkoly počítají v celých číslech."
        footer={
          <Button onClick={() => setStepOpen(false)}>Hotovo</Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hotovo" htmlFor="task-manual" hint={`z ${formatNumber(task.target)}`}>
            <Input
              id="task-manual"
              value={manual}
              inputMode="numeric"
              onChange={(e) => setManual(e.target.value)}
              onBlur={() => {
                const v = parseWhole(manual);
                if (Number.isFinite(v)) setTaskCurrent(task.id, v);
              }}
            />
          </Field>
          <Field label="O kolik skočí + a −" htmlFor="task-step-inline" hint="1 = po jednom">
            <Input
              id="task-step-inline"
              value={String(task.step)}
              inputMode="numeric"
              onChange={(e) => {
                const v = parseWhole(e.target.value);
                if (Number.isFinite(v) && v > 0) updateTask(task.id, { step: v });
              }}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Smazat úkol "${task.name}"?`}
        description={
          children.length > 0
            ? `Zmizí i ${children.length} ${plural(children.length, "podúkol", "podúkoly", "podúkolů")}.`
            : "Postup projektu se přepočítá."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteTask(task.id);
                router.push(`/projects?id=${task.projectId}`);
              }}
            >
              <Trash2 /> Smazat
            </Button>
          </>
        }
      />
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
