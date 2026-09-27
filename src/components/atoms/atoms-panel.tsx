"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  descendantsOf,
  displayPercent,
  isTaskDone,
  leavesOf,
  projectById,
  subtasksOf,
  taskPercent,
  tasksOfProject,
} from "@/lib/projects";
import type { MicroWinsState, Task } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

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
 * Strom se kreslí odsazením, ne jako graf na plátně: na šířku telefonu se
 * pod sebe vejde desítka uzlů, vedle sebe tři.
 */
export function AtomsPanel() {
  const { state } = useStore();
  const [selected, setSelected] = React.useState<string | null>(null);

  /* V liště jsou úkoly nejvyšší úrovně ze všech neodložených projektů - to jsou
     ty celky, které se rozsekávají. Podúkoly v ní nejsou, ty už jsou uvnitř. */
  const tasks = React.useMemo(() => topTasks(state), [state]);
  const current = tasks.find((t) => t.id === selected) ?? tasks[0] ?? null;

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-medium">Zatím není co rozsekávat</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Atomizér pracuje s úkoly projektů. Založ projekt a v něm úkol - tady se pak dá
            rozdrobit na jednotlivé kroky.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TaskStrip tasks={tasks} current={current} onPick={setSelected} />
      {current ? <AtomMap key={current.id} task={current} /> : null}
    </div>
  );
}

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
}: {
  tasks: Task[];
  current: Task | null;
  onPick: (id: string) => void;
}) {
  const { state } = useStore();

  return (
    /* Lišta se posouvá do boku - na telefon se vejdou dva a půl úkolu a
       přetahovat je není proč, pořadí drží projekt. */
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-2 pb-1">
        {tasks.map((task) => {
          const active = current?.id === task.id;
          const percent = taskPercent(state, task);
          const project = projectById(state, task.projectId);
          const atoms = leavesOf(state, task.id);
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
              <span className="truncate text-[11px] text-muted-foreground">{project?.name}</span>
              <ProgressBar value={percent} />
              <span className="tabular text-[11px] text-muted-foreground">
                {displayPercent(percent)} % · {done} / {atoms.length}{" "}
                {plural(atoms.length, "atom", "atomy", "atomů")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- mapa jednoho úkolu -----------------------------------------------------

interface TreeCtrl {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  adding: string | null;
  setAdding: (id: string | null) => void;
  confirm: (task: Task) => void;
}

const Ctrl = React.createContext<TreeCtrl | null>(null);

function useCtrl(): TreeCtrl {
  const ctx = React.useContext(Ctrl);
  if (!ctx) throw new Error("AtomNode musí být uvnitř AtomMap");
  return ctx;
}

function AtomMap({ task }: { task: Task }) {
  const { state, deleteTask } = useStore();
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Task | null>(null);

  const ctrl = React.useMemo<TreeCtrl>(
    () => ({
      collapsed,
      toggle: (id) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      editing,
      setEditing,
      adding,
      setAdding,
      confirm: setPending,
    }),
    [collapsed, editing, adding],
  );

  const atoms = leavesOf(state, task.id);
  const done = atoms.filter((a) => isTaskDone(state, a)).length;
  const percent = taskPercent(state, task);
  const below = descendantsOf(state, pending?.id ?? task.id).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {task.name}
        </h2>
        <span className="tabular text-xs text-muted-foreground">
          {done} / {atoms.length} · {displayPercent(percent)} %
        </span>
        <Link
          href={`/tasks?id=${task.id}`}
          aria-label="Otevřít úkol"
          title="Otevřít úkol"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      <Card className="overflow-hidden p-2 sm:p-3">
        <Ctrl.Provider value={ctrl}>
          <AtomBranch task={task} depth={0} />
        </Ctrl.Provider>
      </Card>

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

/** Uzel stromu i s tím, co pod ním visí. Odsazení dělá zanořený rámeček. */
function AtomBranch({ task, depth }: { task: Task; depth: number }) {
  const { state } = useStore();
  const ctrl = useCtrl();
  const children = subtasksOf(state, task.id);
  const open = !ctrl.collapsed.has(task.id);

  return (
    <div className="min-w-0">
      <AtomRow task={task} depth={depth} childCount={children.length} open={open} />

      {open && (children.length > 0 || ctrl.adding === task.id) ? (
        <div className="ml-2.5 min-w-0 border-l pl-1.5">
          {children.map((child) => (
            <AtomBranch key={child.id} task={child} depth={depth + 1} />
          ))}
          {ctrl.adding === task.id ? <AddRow parent={task} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function AtomRow({
  task,
  depth,
  childCount,
  open,
}: {
  task: Task;
  depth: number;
  childCount: number;
  open: boolean;
}) {
  const { state, toggleTaskDone, updateTask } = useStore();
  const ctrl = useCtrl();
  const percent = taskPercent(state, task);
  const done = isTaskDone(state, task);
  const leaf = childCount === 0;
  const editing = ctrl.editing === task.id;

  const rename = (text: string) => {
    const value = text.trim();
    if (value && value !== task.name) updateTask(task.id, { name: value });
    ctrl.setEditing(null);
  };

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md py-1 pr-0.5",
        depth === 0 && "font-medium",
      )}
    >
      {leaf ? (
        /* Atom se dá jen odškrtnout - to je konec rozsekávání. */
        <button
          type="button"
          onClick={() => {
            void (done ? tapFeedback() : winFeedback());
            toggleTaskDone(task.id);
          }}
          aria-pressed={done}
          aria-label={done ? `Vrátit zpět: ${task.name}` : `Hotovo: ${task.name}`}
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
            done
              ? "border-progress bg-progress text-progress-foreground"
              : "border-muted-foreground/40",
          )}
        >
          {done ? <Check className="size-3" /> : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => ctrl.toggle(task.id)}
          aria-expanded={open}
          aria-label={open ? `Sbalit ${task.name}` : `Rozbalit ${task.name}`}
          className="grid size-4 shrink-0 place-items-center text-muted-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      )}

      {editing ? (
        <Input
          autoFocus
          defaultValue={task.name}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") rename(e.currentTarget.value);
            if (e.key === "Escape") ctrl.setEditing(null);
          }}
          aria-label="Název"
          className="h-7 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={() => ctrl.setEditing(task.id)}
          title={task.name}
          className={cn(
            "min-w-0 flex-1 truncate py-0.5 text-left text-sm",
            done && leaf && "text-muted-foreground line-through",
          )}
        >
          {task.name}
        </button>
      )}

      {!editing && !leaf ? (
        <span className="tabular shrink-0 text-[11px] text-muted-foreground">
          {displayPercent(percent)} %
        </span>
      ) : null}

      {editing ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Smazat"
          className="shrink-0 hover:text-destructive"
          /* `onMouseDown`, ne `onClick`: klik by přišel až po `blur` pole,
             které editaci zavře, a tlačítko by zmizelo dřív, než se stihne. */
          onMouseDown={(e) => {
            e.preventDefault();
            ctrl.setEditing(null);
            ctrl.confirm(task);
          }}
        >
          <Trash2 />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rozsekat ${task.name}`}
          title="Rozsekat na menší kusy"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => {
            ctrl.setAdding(task.id);
            if (ctrl.collapsed.has(task.id)) ctrl.toggle(task.id);
          }}
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}

/**
 * Řádek pro nový kus pod uzlem. Enter ho založí a pole zůstane otevřené -
 * rozsekávání je dávka, ne jeden zápis: kdo dělí úkol, píše rovnou pět věcí
 * pod sebe.
 */
function AddRow({ parent }: { parent: Task }) {
  const { createTask } = useStore();
  const ctrl = useCtrl();
  const [draft, setDraft] = React.useState("");

  const submit = (keepOpen: boolean) => {
    const value = draft.trim();
    if (value) {
      // Cíl 1 = zaškrtávátko. Atom je hotový, nebo není; procenta si počítá
      // rodič z toho, kolik jich je odškrtnutých.
      createTask(parent.projectId, { name: value, target: 1, parentId: parent.id });
      void tapFeedback();
    }
    setDraft("");
    if (!keepOpen || !value) ctrl.setAdding(null);
  };

  return (
    <div className="flex items-center gap-1 py-1 pr-0.5">
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
        <Plus className="size-3" />
      </span>
      <Input
        autoFocus
        value={draft}
        placeholder="Menší kus…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => submit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit(true);
          }
          if (e.key === "Escape") {
            setDraft("");
            ctrl.setAdding(null);
          }
        }}
        aria-label={`Nový kus pod ${parent.name}`}
        className="h-7 text-sm"
      />
    </div>
  );
}
