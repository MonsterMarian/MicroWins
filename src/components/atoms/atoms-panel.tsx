"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { tapFeedback } from "@/lib/native";
import {
  atomsOf,
  descendantsOf,
  displayPercent,
  isTaskDone,
  projectById,
  subtasksOf,
  taskPercent,
  tasksOfProject,
} from "@/lib/projects";
import type { MicroWinsState, Task } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { AtomCanvas } from "./atom-canvas";
import { AtomEditor } from "./atom-editor";

/**
 * Atomizér - rozsekání úkolu na stále menší kusy.
 *
 * Nahoře je posouvací lišta úkolů, pod ní mapa jednoho z nich: nahoře úkol,
 * pod ním jeho části, pod nimi ještě menší části, až dolů k atomům, které se
 * dají jen odškrtnout.
 *
 * Žádná vlastní data: atom **je** podúkol, jak ho appka zná odjakživa. Díky
 * tomu se rozsekání rovnou počítá do procent úkolu i projektu a hotový atom
 * posouvá postup - kdyby měl atomizér vlastní strukturu, žil by každý úkol
 * dvakrát a čísla by si odporovala.
 *
 * Mapa se kreslí jako graf na plátně (`atom-canvas.tsx`), ne odsazeným
 * seznamem: rozsekaný úkol se čte jako strom, ne jako odrážky.
 */
export function AtomsPanel() {
  const { state } = useStore();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  /* V liště jsou úkoly nejvyšší úrovně ze všech neodložených projektů - to jsou
     ty celky, které se rozsekávají. Podúkoly v ní nejsou, ty už jsou uvnitř. */
  const tasks = React.useMemo(() => topTasks(state), [state]);
  const current = tasks.find((t) => t.id === selected) ?? tasks[0] ?? null;

  return (
    <div className="flex flex-col gap-3">
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">Zatím není co rozsekávat</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Atomizér krájí úkoly na menší kusy. Nemusíš kvůli tomu nic chystat jinde - založ
              úkol rovnou tady, klidně do projektu, který nikde jinde nebude svítit.
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Nový úkol
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <TaskStrip
            tasks={tasks}
            current={current}
            onPick={setSelected}
            onNew={() => setCreating(true)}
          />
          {current ? <AtomMap key={current.id} task={current} /> : null}
        </>
      )}

      <NewTaskDialog open={creating} onOpenChange={setCreating} onCreated={setSelected} />
    </div>
  );
}

/**
 * Nový úkol k rozsekání - i s projektem, když pro něj ještě žádný není.
 *
 * Projekt se dá založit **schovaný**: nápad, který se teprve krájí, nemusí
 * hned zabírat řádek mezi projekty s procenty a deadlinem. Přepnout se to dá
 * kdykoliv potom nad mapou.
 */
function NewTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: string) => void;
}) {
  const { state, createProject, createTask } = useStore();
  const projects = React.useMemo(
    () =>
      state.projects
        .filter((p) => p.archivedAt === null)
        .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    [state.projects],
  );

  const [name, setName] = React.useState("");
  const [projectId, setProjectId] = React.useState<string>(NEW_PROJECT);
  const [projectName, setProjectName] = React.useState("");
  const [listed, setListed] = React.useState(true);

  // Při otevření se formulář vrátí na začátek; předvybraný je první projekt.
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setProjectName("");
    setListed(true);
    setProjectId(projects[0]?.id ?? NEW_PROJECT);
  }, [open, projects]);

  const fresh = projectId === NEW_PROJECT;
  const ready = name.trim() !== "" && (!fresh || projectName.trim() !== "");

  const submit = () => {
    if (!ready) return;
    const target = fresh
      ? createProject({ name: projectName.trim(), icon: "🧩", hidden: !listed }).id
      : projectId;
    // Cíl 1: úkol se zatím jen odškrtává. Jakmile se rozseká, počítá se z kusů.
    const task = createTask(target, { name: name.trim(), target: 1 });
    void tapFeedback();
    onCreated(task.id);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nový úkol k rozsekání"
      description="Úkol vždycky někam patří - buď do projektu, který už máš, nebo do nového."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button disabled={!ready} onClick={submit}>
            <Plus /> Založit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Co je potřeba udělat" htmlFor="atom-name">
          <Input
            id="atom-name"
            autoFocus
            value={name}
            placeholder="Např. Spustit web"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) submit();
            }}
          />
        </Field>

        <Field label="Projekt" htmlFor="atom-project">
          <Select
            id="atom-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.hidden ? " (jen tady)" : ""}
              </option>
            ))}
            <option value={NEW_PROJECT}>— nový projekt —</option>
          </Select>
        </Field>

        {fresh ? (
          <>
            <Field label="Název projektu" htmlFor="atom-project-name">
              <Input
                id="atom-project-name"
                value={projectName}
                placeholder="Např. Nápady"
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready) submit();
                }}
              />
            </Field>

            <button
              type="button"
              onClick={() => setListed((v) => !v)}
              aria-pressed={listed}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                listed ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">Ukázat i v Projektech</span>
                <span className="block text-xs text-muted-foreground">
                  {listed
                    ? "Běžný projekt s procenty, termínem a statistikami."
                    : "Zůstane jen v atomizéru - do seznamu projektů ani do přehledů se nedostane."}
                </span>
              </span>
              <span
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                  listed ? "bg-progress" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 size-4 rounded-full bg-card shadow transition-[left] duration-200",
                    listed ? "left-6" : "left-1",
                  )}
                />
              </span>
            </button>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

const NEW_PROJECT = "__new__";

/** Úkoly nejvyšší úrovně napříč projekty, v pořadí projektů. */
function topTasks(state: MicroWinsState): Task[] {
  return state.projects
    .filter((p) => p.archivedAt === null)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    .flatMap((p) => tasksOfProject(state, p.id));
}

function TaskStrip({
  tasks,
  current,
  onPick,
  onNew,
}: {
  tasks: Task[];
  current: Task | null;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const { state } = useStore();

  return (
    /* Lišta se posouvá do boku - na telefon se vejdou dva a půl úkolu a
       přetahovat je není proč, pořadí drží projekt. */
    <div className="scroll-quiet -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-2 pb-1">
        {tasks.map((task) => {
          const active = current?.id === task.id;
          const percent = taskPercent(state, task);
          const project = projectById(state, task.projectId);
          const atoms = atomsOf(state, task.id);
          const done = atoms.filter((a) => isTaskDone(state, a)).length;

          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onPick(task.id)}
              aria-pressed={active}
              className={cn(
                "flex w-40 shrink-0 flex-col gap-1 rounded-xl border p-2.5 text-left transition-colors",
                active ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className="flex items-center gap-1.5">
                <EntityIcon icon={task.icon} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.name}</span>
              </span>
              <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                {project?.hidden ? <EyeOff className="size-2.5 shrink-0" /> : null}
                <span className="truncate">{project?.name}</span>
              </span>
              <ProgressBar value={percent} />
              <span className="tabular text-[11px] text-muted-foreground">
                {displayPercent(percent)} % · {done} / {atoms.length}{" "}
                {plural(atoms.length, "atom", "atomy", "atomů")}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onNew}
          aria-label="Nový úkol k rozsekání"
          className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-2.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="size-4" />
          <span className="text-[11px]">Nový úkol</span>
        </button>
      </div>
    </div>
  );
}

// --- mapa jednoho úkolu -----------------------------------------------------

function AtomMap({ task }: { task: Task }) {
  const { state, deleteTask, updateProject } = useStore();
  const project = projectById(state, task.projectId);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Task | null>(null);

  const toggle = React.useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const atoms = atomsOf(state, task.id);
  const done = atoms.filter((a) => isTaskDone(state, a)).length;
  const percent = taskPercent(state, task);
  const below = descendantsOf(state, pending?.id ?? task.id).length;

  /* Sbalit jde všechno, co má pod sebou další kusy - kromě kořene. Sbalený
     kořen by z celé mapy nechal jeden rámeček a to není přehled, to je prázdno. */
  const parents = React.useMemo(
    () =>
      descendantsOf(state, task.id)
        .filter((t) => subtasksOf(state, t.id).length > 0)
        .map((t) => t.id),
    [state, task.id],
  );
  const allCollapsed = parents.length > 0 && parents.every((id) => collapsed.has(id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {task.name}
        </h2>
        <span className="tabular text-xs text-muted-foreground">
          {done} / {atoms.length} · {displayPercent(percent)} %
        </span>
        {parents.length > 0 ? (
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parents))}
            aria-label={allCollapsed ? "Rozbalit celou mapu" : "Sbalit mapu na první patro"}
            title={allCollapsed ? "Rozbalit celou mapu" : "Sbalit mapu na první patro"}
            className="text-muted-foreground hover:text-foreground"
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-3.5" />
            ) : (
              <ChevronsDownUp className="size-3.5" />
            )}
          </button>
        ) : null}
        {/* Schovaný projekt se dá kdykoliv vytáhnout mezi ostatní - a zase schovat. */}
        {project ? (
          <button
            type="button"
            onClick={() => updateProject(project.id, { hidden: !project.hidden })}
            aria-pressed={project.hidden === true}
            aria-label={
              project.hidden ? "Ukázat projekt i v Projektech" : "Schovat projekt z Projektů"
            }
            title={
              project.hidden
                ? `"${project.name}" je jen tady - ukázat i v Projektech`
                : `"${project.name}" je vidět v Projektech - schovat`
            }
            className="text-muted-foreground hover:text-foreground"
          >
            {project.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        ) : null}
        <Link
          href={`/tasks?id=${task.id}`}
          aria-label="Otevřít úkol"
          title="Otevřít úkol"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      <AtomCanvas
        root={task}
        collapsed={collapsed}
        onToggle={toggle}
        onOpen={(t) => setOpenId(t.id)}
        adding={adding}
        onAdding={setAdding}
      />

      <p className="px-1 text-xs text-muted-foreground">
        Plátno posouváš prstem po prázdném místě, dvěma prsty zoomuješ. Buňku chytíš a odtáhneš
        kam chceš - puštěná na jinou buňku se pod ni převěsí. Ťuknutím ji upravíš (nadpis,
        zaškrtávátko nebo počítadlo, popis), <span className="font-medium">+</span> pod ní ji
        rozseká na menší kusy.
      </p>

      <AtomEditor
        task={openId ? (state.tasks.find((t) => t.id === openId) ?? null) : null}
        onClose={() => setOpenId(null)}
        onDelete={setPending}
      />

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? `Smazat "${pending.name}"?` : ""}
        description={
          below > 0
            ? `Zmizí i ${below} ${plural(below, "kus", "kusy", "kusů")} pod ním. Postup se přepočítá.`
            : "Postup se přepočítá."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pending) deleteTask(pending.id);
                setPending(null);
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

