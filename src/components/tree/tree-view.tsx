"use client";

import * as React from "react";
import {
  Check,
  ChevronRight,
  FolderPlus,
  Gauge,
  Pencil,
  Plus,
  Square,
  Star,
  Trash2,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { EntryDialog } from "./entry-dialog";
import { CheckEntries, MetricEntries, OnceDetail } from "./metric-entries";
import { NodeDialog, type NodeDialogState } from "./node-dialog";
import { formatDate } from "@/lib/date";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  childrenOf,
  microwinsInSubtree,
  onceEntry,
  subtreeIds,
  summarizeFlag,
  summarizeMetric,
} from "@/lib/domain";
import type { TreeNode } from "@/lib/types";
import { cn, formatNumber, plural } from "@/lib/utils";

export function TreeView() {
  const { state, hydrated, deleteNode } = useStore();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [entryFor, setEntryFor] = React.useState<TreeNode | null>(null);
  const [nodeRequest, setNodeRequest] = React.useState<NodeDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<TreeNode | null>(null);
  const initialized = React.useRef(false);

  // Po načtení dat rozbal kategorie, ať je strom hned čitelný.
  React.useEffect(() => {
    if (!hydrated || initialized.current || state.nodes.length === 0) return;
    initialized.current = true;
    setExpanded(new Set(state.nodes.filter((n) => n.kind === "category").map((n) => n.id)));
  }, [hydrated, state.nodes]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const roots = childrenOf(state.nodes, null);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Strom úspěchů</h2>
          <p className="text-xs text-muted-foreground">
            Složky → winy: číselné, zaškrtávací nebo jednorázové.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNodeRequest({ kind: "category", parentId: null })}
          >
            <FolderPlus /> Složka
          </Button>
          <Button size="sm" onClick={() => setNodeRequest({ kind: "metric", parentId: null })}>
            <Plus /> Win
          </Button>
        </div>
      </header>

      <Card className="p-1.5">
        {roots.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm font-medium">Zatím prázdno</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Založ složku (Business, Fitness) a pod ni win: číselný
              (<span className="font-mono text-xs">X cold calls za den</span>), zaškrtávací
              (Ranní protažení) nebo jednorázový.
            </p>
            <Button size="sm" onClick={() => setNodeRequest({ kind: "category", parentId: null })}>
              <FolderPlus /> Nová složka
            </Button>
          </div>
        ) : (
          <ul>
            {roots.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                onAddEntry={setEntryFor}
                onNodeRequest={setNodeRequest}
                onDelete={setPendingDelete}
              />
            ))}
          </ul>
        )}
      </Card>

      <EntryDialog
        metric={entryFor}
        open={entryFor !== null}
        onOpenChange={(open) => !open && setEntryFor(null)}
      />
      <NodeDialog request={nodeRequest} onOpenChange={(open) => !open && setNodeRequest(null)} />

      {pendingDelete ? (
        <DeleteDialog
          node={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteNode(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onAddEntry: (metric: TreeNode) => void;
  onNodeRequest: (req: NodeDialogState) => void;
  onDelete: (node: TreeNode) => void;
}

function NodeRow(props: RowProps) {
  const { node, depth, expanded, onToggle, onAddEntry, onNodeRequest, onDelete } = props;
  const { state, today, toggleCheck } = useStore();
  const { toast } = useToast();
  const isOpen = expanded.has(node.id);
  const children = childrenOf(state.nodes, node.id);
  const isCategory = node.kind === "category";
  const hasBody = !isCategory || children.length > 0;

  const check = node.kind === "check" ? summarizeFlag(state, node, today) : null;

  const onCheck = () => {
    const res = toggleCheck(node.id);
    void (res.checked ? winFeedback() : tapFeedback());
    toast(
      res.checked
        ? { tone: "win", title: `Microwin! ${node.name}`, description: "Dnešek je odškrtnutý." }
        : { tone: "warn", title: "Odškrtnuto", description: `${node.name} - dnešní microwin padl.` },
    );
  };

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-md py-1.5 pr-1.5 transition-colors hover:bg-accent/60",
        )}
        style={{ paddingLeft: depth * 18 + 6 }}
      >
        <button
          type="button"
          onClick={() => hasBody && onToggle(node.id)}
          aria-label={isOpen ? "Sbalit" : "Rozbalit"}
          aria-expanded={hasBody ? isOpen : undefined}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded text-muted-foreground",
            hasBody ? "hover:bg-accent" : "invisible",
          )}
        >
          <ChevronRight
            className={cn("size-4 transition-transform", isOpen && "rotate-90")}
          />
        </button>

        <KindIcon node={node} />

        <span
          className={cn("min-w-0 truncate text-sm", isCategory && "font-medium")}
          title={node.name}
        >
          {node.name}
        </span>

        {node.kind === "metric" ? <MetricBadges node={node} /> : null}
        {node.kind === "check" && check ? <CheckBadges summary={check} /> : null}
        {node.kind === "once" ? <OnceBadge node={node} /> : null}
        {isCategory ? <CategoryBadge nodeId={node.id} /> : null}

        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {isCategory ? (
            <IconAction
              label="Přidat do složky"
              onClick={() => onNodeRequest({ kind: "metric", parentId: node.id })}
            >
              <Plus />
            </IconAction>
          ) : null}
          <IconAction
            label="Upravit"
            onClick={() => onNodeRequest({ kind: node.kind, parentId: node.parentId, node })}
          >
            <Pencil />
          </IconAction>
          <IconAction label="Smazat" onClick={() => onDelete(node)} destructive>
            <Trash2 />
          </IconAction>
        </div>

        {node.kind === "metric" ? (
          <Button size="sm" className="ml-1 shrink-0" onClick={() => onAddEntry(node)}>
            <Plus /> Zápis
          </Button>
        ) : null}

        {node.kind === "check" && check ? (
          <Button
            size="sm"
            variant={check.doneToday ? "win" : "outline"}
            className="ml-1 shrink-0"
            aria-pressed={check.doneToday}
            aria-label={check.doneToday ? "Odškrtnout dnešek" : "Zaškrtnout dnešek"}
            title={check.doneToday ? "Odškrtnout dnešek" : "Zaškrtnout dnešek"}
            onClick={onCheck}
          >
            {check.doneToday ? <Check /> : <Square />}
            <span className="hidden sm:inline">
              {check.doneToday ? "Dnes hotovo" : "Dnes"}
            </span>
          </Button>
        ) : null}
      </div>

      {isOpen && node.kind === "metric" ? (
        <div style={{ paddingLeft: depth * 18 + 34 }} className="pb-2 pr-2">
          <MetricEntries metric={node} />
        </div>
      ) : null}

      {isOpen && node.kind === "check" ? (
        <div style={{ paddingLeft: depth * 18 + 34 }} className="pb-2 pr-2">
          <CheckEntries node={node} />
        </div>
      ) : null}

      {isOpen && node.kind === "once" ? (
        <div style={{ paddingLeft: depth * 18 + 34 }} className="pb-2 pr-2">
          <OnceDetail node={node} />
        </div>
      ) : null}

      {isOpen && children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <NodeRow key={child.id} {...props} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function KindIcon({ node }: { node: TreeNode }) {
  if (node.kind === "metric") return <Gauge className="size-3.5 shrink-0 text-muted-foreground" />;
  if (node.kind === "check")
    return <Check className="size-3.5 shrink-0 text-muted-foreground" />;
  if (node.kind === "once") return <Star className="size-3.5 shrink-0 text-muted-foreground" />;
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />;
}

function MetricBadges({ node }: { node: TreeNode }) {
  const { state, today } = useStore();
  const summary = summarizeMetric(state, node, today);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Badge variant="outline" className="tabular">
        rekord {summary.record.value > 0 ? formatNumber(summary.record.value) : "—"}
        {summary.record.value > 0 && node.unit ? ` ${node.unit}` : ""}
      </Badge>
      {summary.todayTotal > 0 ? (
        <Badge variant={summary.hasMicrowinToday ? "win" : "default"} className="tabular">
          {summary.hasMicrowinToday ? <Trophy /> : null}
          dnes {formatNumber(summary.todayTotal)}
        </Badge>
      ) : null}
    </div>
  );
}

function CheckBadges({ summary }: { summary: ReturnType<typeof summarizeFlag> }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Badge variant="outline" className="tabular hidden sm:inline-flex">
        {summary.dayCount} {plural(summary.dayCount, "den", "dny", "dní")}
      </Badge>
      {summary.streak > 1 ? (
        <Badge variant="outline" className="tabular hidden sm:inline-flex">
          série {summary.streak}
        </Badge>
      ) : null}
      {summary.doneToday ? (
        <Badge variant="win">
          <Trophy /> dnes
        </Badge>
      ) : null}
    </div>
  );
}

function OnceBadge({ node }: { node: TreeNode }) {
  const { state } = useStore();
  const entry = onceEntry(state.entries, node.id);

  return (
    <Badge variant="outline" className="tabular shrink-0">
      {entry ? formatDate(entry.date) : "bez data"}
    </Badge>
  );
}

function CategoryBadge({ nodeId }: { nodeId: string }) {
  const { state } = useStore();
  const wins = microwinsInSubtree(state, nodeId);

  if (wins === 0) return null;
  return (
    <Badge variant="outline" className="tabular shrink-0">
      {wins} {plural(wins, "microwin", "microwiny", "microwinů")}
    </Badge>
  );
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "text-muted-foreground",
        destructive ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

function DeleteDialog({
  node,
  onCancel,
  onConfirm,
}: {
  node: TreeNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { state } = useStore();
  const ids = new Set(subtreeIds(state.nodes, node.id));
  const entries = state.entries.filter((e) => ids.has(e.metricId)).length;
  const wins = state.microwins.filter((m) => ids.has(m.metricId)).length;
  const nodes = ids.size - 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={`Smazat "${node.name}"?`}
      description="Smazání je nevratné - záznamy i microwiny celého podstromu zmizí."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Zrušit
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <Trash2 /> Smazat
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
        <li>
          {nodes} {plural(nodes, "vnořený uzel", "vnořené uzly", "vnořených uzlů")}
        </li>
        <li>
          {entries} {plural(entries, "záznam", "záznamy", "záznamů")}
        </li>
        <li>
          {wins} {plural(wins, "microwin", "microwiny", "microwinů")}
        </li>
      </ul>
    </Dialog>
  );
}
