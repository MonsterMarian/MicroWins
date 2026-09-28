"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronRight, Maximize2, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  edgePath,
  layoutTree,
  NODE_HEIGHT,
  NODE_WIDTH,
  type PlacedNode,
  type TreeInput,
} from "@/lib/atom-tree";
import {
  descendantsOf,
  displayPercent,
  isTaskDone,
  subtasksOf,
  taskPercent,
} from "@/lib/projects";
import type { MicroWinsState, Task } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { useAtomDrag, type AtomDrag } from "./use-atom-drag";

/**
 * Mapa rozsekaného úkolu jako **kreslený strom**: kořen nahoře, pod ním patra
 * jeho kusů spojená čarami, dole atomy k odškrtnutí.
 *
 * Plátno se posouvá prstem (obyčejné scrollování) a jako celek se škáluje -
 * po otevření se strom sám napasuje na šířku, dál si ho jde přiblížit. Uzly
 * jsou obyčejné HTML prvky nad SVG s hranami: text se pak dá zalomit
 * a tlačítka uvnitř uzlu fungují jako všude jinde.
 *
 * Kus se dá přetáhnout na jiný a tím pod něj převěsit - rozsekávání je hádání,
 * takže se první nástřel skoro nikdy netrefí a přerovnat mapu musí jít bez
 * mazání a psaní znovu.
 */

/** Virtuální uzel pro rozepsaný nový kus - v layoutu zabere místo jako dítě. */
const ADD_ID = "__add__";

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.4;

export interface AtomCanvasProps {
  root: Task;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  editing: string | null;
  onEditing: (id: string | null) => void;
  adding: string | null;
  onAdding: (id: string | null) => void;
  onDelete: (task: Task) => void;
}

export function AtomCanvas(props: AtomCanvasProps) {
  const { state, reparentTask } = useStore();
  const { toast } = useToast();
  const { root, collapsed, adding, onToggle } = props;
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  /** `null` = napasovat na šířku; číslo = uživatel si přiblížil sám. */
  const [zoom, setZoom] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tree = React.useMemo(
    () => layoutTree(buildTree(state, root, collapsed, adding)),
    [state, root, collapsed, adding],
  );

  const fit = width > 0 ? clampZoom((width - 24) / tree.width) : 1;
  const scale = zoom ?? Math.min(1, fit);
  const nodeById = React.useMemo(
    () => new Map(tree.nodes.map((n) => [n.id, n])),
    [tree],
  );
  const taskById = React.useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);

  /* Plátno se při tažení u kraje samo posouvá - mapa bývá větší než okénko. */
  const drag = useAtomDrag((source, target) => {
    const task = taskById.get(source.id);
    if (!task || !canDrop(state, source.id, target.id)) return;
    const parent = taskById.get(target.id);
    const previous = task.parentId;

    reparentTask(source.id, target.id);
    // Sbalený cíl se rozbalí, ať je vidět, kam kus spadl.
    if (collapsed.has(target.id)) onToggle(target.id);
    toast({
      tone: "info",
      title: `Převěšeno pod "${parent?.name ?? ""}"`,
      description: source.title,
      action: { label: "Vrátit", onClick: () => reparentTask(source.id, previous) },
    });
  }, () => wrapRef.current);

  /**
   * Kam se tažený kus pustit nedá: na sebe, na svoje potomky (strom by se
   * zacyklil) a tam, kde už visí. Počítá se jednou za tah, ne u každého uzlu.
   */
  const held = drag.ghost?.source.id ?? null;
  const blocked = React.useMemo(() => {
    if (held === null) return null;
    const set = new Set<string>([held]);
    for (const child of descendantsOf(state, held)) set.add(child.id);
    const parent = taskById.get(held)?.parentId;
    if (parent) set.add(parent);
    return set;
  }, [held, state, taskById]);

  return (
    <Card className="relative overflow-hidden p-0">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border bg-card/90 p-0.5 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Oddálit"
          onClick={() => setZoom(clampZoom(scale - 0.15))}
        >
          <Minus />
        </Button>
        <span className="tabular w-9 text-center text-[11px] text-muted-foreground">
          {Math.round(scale * 100)} %
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Přiblížit"
          onClick={() => setZoom(clampZoom(scale + 0.15))}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Napasovat na šířku"
          title="Napasovat na šířku"
          onClick={() => setZoom(null)}
        >
          <Maximize2 />
        </Button>
      </div>

      <div ref={wrapRef} className="max-h-[60vh] overflow-auto p-3">
        <div
          className="relative"
          style={{ width: tree.width * scale, height: tree.height * scale }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: tree.width, height: tree.height, transform: `scale(${scale})` }}
          >
            <svg
              width={tree.width}
              height={tree.height}
              className="pointer-events-none absolute inset-0"
              aria-hidden
            >
              {tree.edges.map((edge) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) return null;
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={edgePath(tree.center(from), tree.center(to))}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>

            {tree.nodes.map((node) =>
              node.id === ADD_ID ? (
                <AddNode key={node.id} node={node} parentId={adding} onDone={props.onAdding} />
              ) : (
                <TaskNode
                  key={node.id}
                  {...props}
                  node={node}
                  task={taskById.get(node.id)}
                  isRoot={root.id === node.id}
                  drag={drag}
                  held={held === node.id}
                  isTarget={drag.target?.id === node.id && blocked !== null && !blocked.has(node.id)}
                />
              ),
            )}
          </div>
        </div>
      </div>

      {drag.ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-[45vw] truncate rounded-md border bg-popover px-2 py-1 text-[11px] shadow-lg"
          style={{ left: drag.ghost.x + 12, top: drag.ghost.y - 10 }}
        >
          {drag.ghost.source.title}
        </div>
      ) : null}
    </Card>
  );
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

/** Smí kus `id` pod `parentId`? Viz `reparentTask`, tohle je jeho obrazovková půlka. */
function canDrop(state: MicroWinsState, id: string, parentId: string): boolean {
  if (id === parentId) return false;
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.parentId === parentId) return false;
  return !descendantsOf(state, id).some((child) => child.id === parentId);
}

/** Strom pro rozmístění: sbalený uzel děti neukazuje, rozepsaný kus je taky uzel. */
function buildTree(
  state: MicroWinsState,
  root: Task,
  collapsed: Set<string>,
  adding: string | null,
): TreeInput {
  const make = (task: Task): TreeInput => {
    const children: TreeInput[] = collapsed.has(task.id)
      ? []
      : subtasksOf(state, task.id).map(make);
    if (adding === task.id) children.push({ id: ADD_ID, children: [] });
    return { id: task.id, children };
  };
  return make(root);
}

function TaskNode({
  node,
  task,
  isRoot,
  collapsed,
  onToggle,
  editing,
  onEditing,
  onAdding,
  onDelete,
  drag,
  held,
  isTarget,
}: Omit<AtomCanvasProps, "root"> & {
  node: PlacedNode;
  task: Task | undefined;
  isRoot: boolean;
  drag: AtomDrag;
  /** Tenhle uzel je zrovna v ruce. */
  held: boolean;
  /** Visí nad ním tažený kus a pustit se sem dá. */
  isTarget: boolean;
}) {
  const { state, toggleTaskDone, updateTask } = useStore();
  if (!task) return null;

  const children = subtasksOf(state, task.id);
  const leaf = children.length === 0;
  const done = isTaskDone(state, task);
  const percent = taskPercent(state, task);
  const open = !collapsed.has(task.id);
  const writing = editing === task.id;

  const rename = (text: string) => {
    const value = text.trim();
    if (value && value !== task.name) updateTask(task.id, { name: value });
    onEditing(null);
  };

  return (
    <div
      data-atom-id={task.id}
      /* Táhne se za celý uzel, jako se v seznamech táhne za řádek - na uzel
         velký jako dva prsty se zvláštní úchyt nevejde. V rozepsaném poli ale
         patří tah výběru textu, tam se tažení nezačíná. */
      onPointerDown={
        writing
          ? undefined
          : (e) => {
              if ((e.target as HTMLElement).closest("input, textarea")) return;
              drag.press({ id: task.id, title: task.name }, e);
            }
      }
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "absolute flex flex-col justify-between rounded-xl border bg-card p-1.5 shadow-sm transition-colors [-webkit-touch-callout:none]",
        isRoot && "border-foreground/30",
        done && "border-progress/50 bg-progress-muted/20",
        held && "opacity-40",
        isTarget && "border-progress bg-progress/20 ring-1 ring-progress",
      )}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <div className="flex min-w-0 items-start gap-1">
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
              "mt-px grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
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
            onClick={() => onToggle(task.id)}
            aria-expanded={open}
            aria-label={open ? `Sbalit ${task.name}` : `Rozbalit ${task.name}`}
            className="mt-px grid size-4 shrink-0 place-items-center text-muted-foreground"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        )}

        {writing ? (
          <Input
            autoFocus
            defaultValue={task.name}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(e.currentTarget.value);
              if (e.key === "Escape") onEditing(null);
            }}
            aria-label="Název"
            className="h-6 px-1 text-[11px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => onEditing(task.id)}
            title={task.name}
            /* Do uzlu se vejdou dva řádky; delší jméno se useklo, ale celé je
               v bublině a po ťuknutí v poli. Bez useknutí text přetékal z uzlu
               přes čáry pod ním. */
            className={cn(
              "line-clamp-2 min-w-0 flex-1 break-words text-left text-[11px] leading-snug",
              done && "text-muted-foreground line-through",
            )}
          >
            {task.name}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {leaf ? null : (
          <>
            <span className="tabular shrink-0 text-[10px] text-muted-foreground">
              {displayPercent(percent)} %
            </span>
            {/* Sbalený uzel řekne, kolik kusů schoval - jinak vypadá jako atom. */}
            {open ? (
              <ProgressBar value={percent} size="sm" quiet className="min-w-0 flex-1" />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                {children.length} {plural(children.length, "kus", "kusy", "kusů")}
              </span>
            )}
          </>
        )}

        {writing ? (
          <button
            type="button"
            aria-label="Smazat"
            /* `onMouseDown`, ne `onClick`: klik by přišel až po `blur` pole,
               které editaci zavře, a tlačítko by zmizelo dřív, než se stihne. */
            onMouseDown={(e) => {
              e.preventDefault();
              onEditing(null);
              onDelete(task);
            }}
            className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Rozsekat ${task.name}`}
            title="Rozsekat na menší kusy"
            onClick={() => {
              onAdding(task.id);
              if (collapsed.has(task.id)) onToggle(task.id);
            }}
            className="ml-auto grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Rozepsaný nový kus visí ve stromu na svém místě, ne v dialogu - je hned
 * vidět, kam padne. Enter ho založí a pole zůstane otevřené: kdo dělí úkol,
 * píše rovnou pět věcí pod sebe.
 */
function AddNode({
  node,
  parentId,
  onDone,
}: {
  node: PlacedNode;
  parentId: string | null;
  onDone: (id: string | null) => void;
}) {
  const { state, createTask } = useStore();
  const [draft, setDraft] = React.useState("");
  const parent = state.tasks.find((t) => t.id === parentId);

  const submit = (keepOpen: boolean) => {
    const value = draft.trim();
    if (value && parent) {
      // Cíl 1 = zaškrtávátko. Atom je hotový, nebo není; procenta si počítá
      // rodič z toho, kolik jich je odškrtnutých.
      createTask(parent.projectId, { name: value, target: 1, parentId: parent.id });
      void tapFeedback();
    }
    setDraft("");
    if (!keepOpen || !value) onDone(null);
  };

  return (
    <div
      className="absolute flex flex-col justify-center rounded-xl border border-dashed bg-card/60 p-1.5"
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
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
            onDone(null);
          }
        }}
        aria-label={parent ? `Nový kus pod ${parent.name}` : "Nový kus"}
        className="h-6 px-1 text-[11px]"
      />
    </div>
  );
}
