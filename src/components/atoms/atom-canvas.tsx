"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Expand,
  LayoutGrid,
  Minus,
  Plus,
  ScanSearch,
  Shrink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  clampZoom,
  edgePath,
  fitCamera,
  NODE_WIDTH,
  zoomAround,
  type Camera,
  type PlacedNode,
  type Point,
  layoutTree,
  type TreeInput,
} from "@/lib/atom-tree";
import {
  descendantsOf,
  displayPercent,
  isTaskDone,
  subtasksOf,
  taskPercent,
  trackerOf,
} from "@/lib/projects";
import type { MapOffset, MicroWinsState, Task } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * Mapa rozsekaného úkolu jako **nekonečné plátno** - podobně jako Miro.
 *
 * - jedním prstem po prázdném místě se plátno posouvá, dvěma se zoomuje
 *   (myší kolečko, na touchpadu sevření prstů)
 * - buňka se dá chytit a odtáhnout kamkoliv; veze s sebou celý svůj podstrom
 *   a místo si pamatuje (`Task.mapOffset`)
 * - puštěná **na jinou buňku** se pod ni převěsí - rozsekávání je hádání, první
 *   nástřel se skoro nikdy netrefí a přerovnat mapu musí jít bez přepisování
 * - ťuknutí na buňku otevře úpravu (nadpis, co je v nadpisu, popis)
 *
 * Výchozí rozmístění pořád dělá strom (`lib/atom-tree.ts`), ruční posun se
 * k němu jen přičítá. Nové kusy tak padají na rozumné místo i v mapě, kterou
 * už někdo přerovnal, a "Srovnat" vrátí všechno do stromu.
 *
 * Buňky jsou obyčejné HTML nad SVG s hranami: text se zalamuje a tlačítka
 * uvnitř fungují jako všude jinde.
 */

/** Virtuální buňka pro rozepsaný nový kus - v rozmístění zabere místo jako dítě. */
const ADD_ID = "__add__";

/** O kolik pixelů se musí prst pohnout, než se z ťuknutí stane tah. */
const DRAG_THRESHOLD = 6;

export interface AtomCanvasProps {
  root: Task;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  adding: string | null;
  onAdding: (id: string | null) => void;
  /** Ťuknutí na buňku - úprava nadpisu, počítadla a popisu. */
  onOpen: (task: Task) => void;
}

/** Co se zrovna děje pod prsty. */
type Gesture =
  | { kind: "idle" }
  /** Prst na buňce, ale ještě se nepohnul dost na tah - může to být ťuknutí. */
  | { kind: "press"; id: string; pointerId: number; start: Point }
  | { kind: "node"; id: string; pointerId: number; start: Point; base: MapOffset }
  | { kind: "pan"; pointerId: number; last: Point }
  | { kind: "pinch"; startDistance: number; startMid: Point; startCamera: Camera };

export function AtomCanvas(props: AtomCanvasProps) {
  const { state, reparentTask, placeTask, resetTaskMap } = useStore();
  const { toast } = useToast();
  const { root, collapsed, adding, onToggle } = props;

  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  /** `null` = napasovat celý strom do okna; jinak si kameru vede uživatel. */
  const [camera, setCamera] = React.useState<Camera | null>(null);
  const [heights, setHeights] = React.useState<Map<string, number>>(() => new Map());
  /** Buňka v ruce a kam se zrovna posunula (v jednotkách plátna). */
  const [live, setLive] = React.useState<{ id: string; offset: MapOffset } | null>(null);
  const [target, setTarget] = React.useState<string | null>(null);
  const [fullscreen, setFullscreen] = React.useState(false);

  const gesture = React.useRef<Gesture>({ kind: "idle" });
  const pointers = React.useRef(new Map<number, Point>());
  /** Po tahu nesmí dopadnout klik - jinak by se po přesunu otevřela úprava. */
  const swallowClick = React.useRef(false);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Změří se hned: observer se hlásí až s prvním snímkem, a ten na pozadí nepřijde.
    setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  const taskById = React.useMemo(() => new Map(state.tasks.map((t) => [t.id, t])), [state.tasks]);

  const layout = React.useMemo(
    () =>
      layoutTree(buildTree(state, root, collapsed, adding), {
        heightOf: (id) => heights.get(id),
        offsetOf: (id) =>
          live?.id === id ? live.offset : (taskById.get(id)?.mapOffset ?? undefined),
      }),
    [state, root, collapsed, adding, heights, live, taskById],
  );
  const nodeById = React.useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const cam =
    camera ??
    (size.width > 0 ? fitCamera(layout.bounds, size.width, size.height) : { x: 0, y: 0, zoom: 1 });
  const camRef = React.useRef(cam);
  camRef.current = cam;

  /* Výšky buněk se měří - popis je volitelný a různě dlouhý a patro stromu
     musí být vysoké jako jeho nejvyšší buňka. `offsetHeight` zoom nezná,
     takže měří v jednotkách plátna. */
  const observer = React.useRef<ResizeObserver | null>(null);
  React.useEffect(() => () => observer.current?.disconnect(), []);
  /* Observer se zakládá až při první buňce: ref buněk běží dřív než efekty,
     takže observer z efektu by první várku buněk minul. */
  const measure = React.useCallback((el: HTMLElement | null) => {
    if (!el) return;
    observer.current ??= new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Map<string, number> | null = null;
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          const id = node.dataset.measure;
          const h = node.offsetHeight;
          if (!id || h === 0 || prev.get(id) === h) continue;
          next ??= new Map(prev);
          next.set(id, h);
        }
        return next ?? prev;
      });
    });
    observer.current.observe(el);
    // Hned i napřímo - observer se hlásí až s prvním snímkem.
    const id = el.dataset.measure;
    const h = el.offsetHeight;
    if (id && h > 0) setHeights((prev) => (prev.get(id) === h ? prev : new Map(prev).set(id, h)));
  }, []);

  /** Kam se buňka `id` pustit nedá: na sebe, na svůj podstrom a tam, kde už visí. */
  const blockedFor = React.useCallback(
    (id: string) => {
      const set = new Set<string>([id, ADD_ID]);
      for (const child of descendantsOf(state, id)) set.add(child.id);
      const parent = taskById.get(id)?.parentId;
      if (parent) set.add(parent);
      return set;
    },
    [state, taskById],
  );
  const blocked = React.useMemo(() => (live ? blockedFor(live.id) : null), [live, blockedFor]);

  const dropTargetAt = (x: number, y: number, id: string): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const over = el?.closest<HTMLElement>("[data-atom-id]")?.dataset.atomId ?? null;
    if (!over || blockedFor(id).has(over)) return null;
    return over;
  };

  // --- gesta ----------------------------------------------------------------

  const local = (clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  /* Dokud si uživatel plátno nesáhl, drží se napasované na celý strom - nový
     kus tak nikdy neuteče mimo obraz. Od prvního posunu, zoomu nebo tahu buňky
     si kameru vede sám; jinak by napasování ujíždělo pod prsty. Obyčejné
     ťuknutí (odškrtnutí, +) kameru nezamyká. */
  const holdCamera = () => setCamera((c) => c ?? camRef.current);

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = {
      kind: "pinch",
      startDistance: Math.max(1, distance(a, b)),
      startMid: midpoint(a, b),
      startCamera: camRef.current,
    };
    // Rozdělaný tah buňky se zahodí - dva prsty znamenají "chci se rozhlédnout".
    holdCamera();
    setLive(null);
    setTarget(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    // V poli se píše a vybírá text - tam gesta nepatří.
    if (el.closest("input, textarea, [data-no-gesture]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    swallowClick.current = false;

    const point = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, point);

    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;

    const node = el.closest<HTMLElement>("[data-atom-id]");
    const id = node?.dataset.atomId;
    if (id && id !== ADD_ID) {
      gesture.current = { kind: "press", id, pointerId: e.pointerId, start: point };
    } else {
      gesture.current = { kind: "pan", pointerId: e.pointerId, last: point };
      capture(e);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const point = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, point);
    const g = gesture.current;

    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = midpoint(a, b);
      const zoom = clampZoom(g.startCamera.zoom * (distance(a, b) / g.startDistance));
      // Bod plátna, který byl na začátku mezi prsty, zůstává mezi nimi.
      const cx = (g.startMid.x - g.startCamera.x) / g.startCamera.zoom;
      const cy = (g.startMid.y - g.startCamera.y) / g.startCamera.zoom;
      setCamera({ zoom, x: mid.x - cx * zoom, y: mid.y - cy * zoom });
      return;
    }

    if (g.kind === "pan" && g.pointerId === e.pointerId) {
      const dx = point.x - g.last.x;
      const dy = point.y - g.last.y;
      g.last = point;
      if (Math.abs(dx) + Math.abs(dy) > 0) swallowClick.current = true;
      setCamera((c) => {
        const base = c ?? camRef.current;
        return { ...base, x: base.x + dx, y: base.y + dy };
      });
      return;
    }

    if (g.kind === "press" && g.pointerId === e.pointerId) {
      if (distance(point, g.start) < DRAG_THRESHOLD) return;
      const base = taskById.get(g.id)?.mapOffset ?? { x: 0, y: 0 };
      gesture.current = { kind: "node", id: g.id, pointerId: g.pointerId, start: g.start, base };
      swallowClick.current = true;
      holdCamera();
      capture(e);
      void tapFeedback();
    }

    const n = gesture.current;
    if (n.kind === "node" && n.pointerId === e.pointerId) {
      const zoom = camRef.current.zoom;
      setLive({
        id: n.id,
        offset: {
          x: n.base.x + (point.x - n.start.x) / zoom,
          y: n.base.y + (point.y - n.start.y) / zoom,
        },
      });
      setTarget(dropTargetAt(e.clientX, e.clientY, n.id));
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;

    if (g.kind === "pinch") {
      // Po sevření zůstane jeden prst - ten plynule přejde do posunu.
      const rest = [...pointers.current.entries()][0];
      gesture.current = rest
        ? { kind: "pan", pointerId: rest[0], last: rest[1] }
        : { kind: "idle" };
      swallowClick.current = true;
      return;
    }

    if (g.kind === "node" && g.pointerId === e.pointerId) {
      const task = taskById.get(g.id);
      const over = cancelled ? null : dropTargetAt(e.clientX, e.clientY, g.id);
      if (task && over) {
        const previousParent = task.parentId;
        const previousOffset = task.mapOffset ?? null;
        reparentTask(task.id, over);
        // Pod novým rodičem se kus postaví tam, kam patří ve stromu.
        placeTask(task.id, null);
        if (collapsed.has(over)) onToggle(over);
        toast({
          tone: "info",
          title: `Převěšeno pod "${taskById.get(over)?.name ?? ""}"`,
          description: task.name,
          action: {
            label: "Vrátit",
            onClick: () => {
              reparentTask(task.id, previousParent);
              placeTask(task.id, previousOffset);
            },
          },
        });
      } else if (task && live?.id === g.id && !cancelled) {
        placeTask(task.id, live.offset);
      }
      setLive(null);
      setTarget(null);
    }

    if (pointers.current.size === 0) gesture.current = { kind: "idle" };
  };

  /* Kolečko myši zoomuje kolem kurzoru (jako Miro), sevření na touchpadu
     přijde jako kolečko s Ctrl. Posun dvěma prsty po touchpadu plátno posouvá.
     Posluchač musí být nepasivní, jinak `preventDefault` neprojde a zoomovala
     by se celá stránka. */
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const mouseWheel = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
      setCamera((c) => {
        const base = c ?? camRef.current;
        if (e.ctrlKey || mouseWheel) {
          return zoomAround(base, base.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), anchor);
        }
        return { ...base, x: base.x - e.deltaX, y: base.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullscreen]);

  // Celá obrazovka se zavírá i Escapem.
  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  const zoomBy = (factor: number) => {
    const base = camRef.current;
    setCamera(zoomAround(base, base.zoom * factor, { x: size.width / 2, y: size.height / 2 }));
  };

  const subtree = React.useMemo(
    () => [root, ...descendantsOf(state, root.id)],
    [state, root],
  );
  const arranged = subtree.some((t) => t.mapOffset);

  const tidy = () => {
    const saved = subtree.filter((t) => t.mapOffset).map((t) => [t.id, t.mapOffset!] as const);
    resetTaskMap(root.id);
    setCamera(null);
    toast({
      tone: "info",
      title: "Mapa srovnaná do stromu",
      action: {
        label: "Vrátit",
        onClick: () => {
          for (const [id, offset] of saved) placeTask(id, offset);
        },
      },
    });
  };

  const grid = 24 * cam.zoom;

  return (
    <div
      className={cn(
        "overflow-hidden border bg-card shadow-sm",
        fullscreen ? "fixed inset-0 z-40 rounded-none border-0" : "relative rounded-xl",
      )}
    >
      <div className="mw-safe-x absolute left-2 right-2 top-2 z-10 flex items-start justify-between gap-2 pointer-events-none">
        {fullscreen ? (
          <span className="mt-1 min-w-0 truncate rounded-lg border bg-card/90 px-2 py-1 text-xs font-medium backdrop-blur pointer-events-auto">
            {root.name}
          </span>
        ) : (
          <span />
        )}
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border bg-card/90 p-0.5 backdrop-blur">
          <Button variant="ghost" size="icon-sm" aria-label="Oddálit" onClick={() => zoomBy(1 / 1.25)}>
            <Minus />
          </Button>
          <span className="tabular w-9 text-center text-[11px] text-muted-foreground">
            {Math.round(cam.zoom * 100)} %
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Přiblížit" onClick={() => zoomBy(1.25)}>
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ukázat celý strom"
            title="Ukázat celý strom"
            onClick={() => setCamera(null)}
          >
            <ScanSearch />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Srovnat do stromu"
            title="Srovnat ručně posunuté buňky zpátky do stromu"
            disabled={!arranged}
            onClick={tidy}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={fullscreen ? "Zmenšit" : "Na celou obrazovku"}
            title={fullscreen ? "Zmenšit" : "Na celou obrazovku"}
            onClick={() => {
              setFullscreen((v) => !v);
              setCamera(null);
            }}
          >
            {fullscreen ? <Shrink /> : <Expand />}
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "relative touch-none select-none overflow-hidden [-webkit-touch-callout:none]",
          fullscreen ? "h-full" : "h-[65dvh] min-h-80",
          gesture.current.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
        )}
        /* Tečkovaný papír jako v Miru - jede s kamerou, takže je vidět posun i zoom. */
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: `${grid}px ${grid}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}
        >
          <svg
            width={1}
            height={1}
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            aria-hidden
          >
            {layout.edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={1.5}
                />
              );
            })}
          </svg>

          {layout.nodes.map((node) =>
            node.id === ADD_ID ? (
              <AddNode
                key={node.id}
                node={node}
                parentId={adding}
                onDone={props.onAdding}
                measure={measure}
              />
            ) : (
              <TaskNode
                key={node.id}
                {...props}
                node={node}
                task={taskById.get(node.id)}
                isRoot={root.id === node.id}
                held={live?.id === node.id}
                isTarget={target === node.id && blocked !== null && !blocked.has(node.id)}
                measure={measure}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Prst se chytí na plátno, ať tah pokračuje i mimo něj. Prohlížeč to umí
 * odmítnout (prst už mezitím pustil) - pak se tah dojede i bez toho.
 */
function capture(e: React.PointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // není co chytat
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Strom pro rozmístění: sbalená buňka děti neukazuje, rozepsaný kus je taky buňka. */
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

/**
 * Buňka mapy: **nadpis** (bílý, tučnější) a pod ním **popis** (šedý).
 *
 * V nadpisu může být zaškrtávátko (hotovo = 100 %), počítadlo `x/y`
 * (3/6 = 50 %), nebo nic - pak je to poznámka a do procent se nepočítá.
 * Buňka s kusy pod sebou má procenta spočítaná z nich, takže místo toho
 * ukazuje pruh.
 */
function TaskNode({
  node,
  task,
  isRoot,
  collapsed,
  onToggle,
  onAdding,
  onOpen,
  held,
  isTarget,
  measure,
}: Omit<AtomCanvasProps, "root" | "adding"> & {
  node: PlacedNode;
  task: Task | undefined;
  isRoot: boolean;
  /** Tahle buňka je zrovna v ruce. */
  held: boolean;
  /** Visí nad ní tažená buňka a pustit se sem dá. */
  isTarget: boolean;
  measure: (el: HTMLElement | null) => void;
}) {
  const { state, toggleTaskDone, adjustTask } = useStore();
  if (!task) return null;

  const children = subtasksOf(state, task.id);
  const tracker = trackerOf(state, task);
  const done = tracker !== "none" && isTaskDone(state, task);
  const percent = taskPercent(state, task);
  const open = !collapsed.has(task.id);

  return (
    <div
      ref={measure}
      data-measure={task.id}
      data-atom-id={task.id}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen(task);
      }}
      className={cn(
        "absolute flex cursor-pointer flex-col gap-1 rounded-xl border bg-card px-2.5 pb-3 pt-2 shadow-sm transition-[border-color,background-color,box-shadow,opacity]",
        isRoot && "border-foreground/30",
        done && "border-progress/50",
        held && "z-20 opacity-80 shadow-lg ring-1 ring-foreground/20 pointer-events-none",
        isTarget && "border-progress bg-progress/15 ring-2 ring-progress",
      )}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        {tracker === "check" ? (
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
                : "border-muted-foreground/50 hover:border-foreground/60",
            )}
          >
            {done ? <Check className="size-3" /> : null}
          </button>
        ) : tracker === "count" ? (
          /* Ťuknutí přičte krok; přesné číslo se dá zapsat v úpravě buňky. */
          <button
            type="button"
            onClick={() => {
              if (task.current >= task.target) return;
              void (task.current + task.step >= task.target ? winFeedback() : tapFeedback());
              adjustTask(task.id, task.step);
            }}
            aria-label={`${task.name}: ${task.current} z ${task.target}, přidat ${task.step}`}
            title="Ťukni a přičte se"
            className={cn(
              "tabular -my-px shrink-0 rounded-md border px-1.5 text-[11px] leading-[18px] transition-colors",
              done
                ? "border-progress bg-progress text-progress-foreground"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {task.current}/{task.target}
          </button>
        ) : null}

        <span
          className={cn(
            "min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug text-foreground dark:text-white",
            done && tracker === "check" && "line-through decoration-foreground/40 opacity-70",
          )}
        >
          {task.name}
        </span>

        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(task.id)}
            aria-expanded={open}
            aria-label={open ? `Sbalit ${task.name}` : `Rozbalit ${task.name}`}
            className="-mr-1 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : null}
      </div>

      {task.description.trim() ? (
        /* Popis je v buňce celý jen do pár řádků - delší se dočte v úpravě. */
        <p className="line-clamp-6 whitespace-pre-line break-words text-[11px] leading-snug text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      {children.length > 0 ? (
        <div className="mt-0.5 flex items-center gap-1.5">
          {open ? (
            <ProgressBar value={percent} size="sm" quiet className="min-w-0 flex-1" />
          ) : (
            /* Sbalená buňka řekne, kolik kusů schovala - jinak vypadá jako atom. */
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
              {children.length} {plural(children.length, "kus", "kusy", "kusů")} schováno
            </span>
          )}
          <span className="tabular shrink-0 text-[10px] text-muted-foreground">
            {displayPercent(percent)} %
          </span>
        </div>
      ) : null}

      {/* Úchyt na rozsekání visí na spodní hraně, odkud vedou čáry k dětem. */}
      <button
        type="button"
        aria-label={`Rozsekat ${task.name}`}
        title="Rozsekat na menší kusy"
        onClick={() => {
          onAdding(task.id);
          if (collapsed.has(task.id)) onToggle(task.id);
        }}
        className="absolute -bottom-2.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="size-3" />
      </button>
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
  measure,
}: {
  node: PlacedNode;
  parentId: string | null;
  onDone: (id: string | null) => void;
  measure: (el: HTMLElement | null) => void;
}) {
  const { state, createTask } = useStore();
  const [draft, setDraft] = React.useState("");
  const parent = state.tasks.find((t) => t.id === parentId);

  const submit = (keepOpen: boolean) => {
    const value = draft.trim();
    if (value && parent) {
      // Cíl 1 = zaškrtávátko. Počítadlo nebo poznámka se přepne v úpravě buňky.
      // Rozsekání kusu s rozdělanou prací ji nesmí smazat - přejde do prvního
      // dílu (`keepParentProgress`), jinak by kus spadl na nulu.
      createTask(parent.projectId, {
        name: value,
        target: 1,
        parentId: parent.id,
        keepParentProgress: true,
      });
      void tapFeedback();
    }
    setDraft("");
    if (!keepOpen || !value) onDone(null);
  };

  return (
    <div
      ref={measure}
      data-measure={ADD_ID}
      data-no-gesture=""
      className="absolute flex flex-col justify-center rounded-xl border border-dashed bg-card/60 p-1.5"
      style={{ left: node.x, top: node.y, width: NODE_WIDTH }}
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
        className="h-8 px-2 text-[13px]"
      />
    </div>
  );
}
