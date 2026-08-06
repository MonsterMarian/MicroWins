"use client";

import * as React from "react";
import {
  ChevronRight,
  FolderPlus,
  Gauge,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useStore } from "@/components/providers/store-provider";
import { EntryDialog } from "./entry-dialog";
import { MetricEntries } from "./metric-entries";
import { NodeDialog, type NodeDialogState } from "./node-dialog";
import { childrenOf, microwinsInSubtree, subtreeIds, summarizeMetric } from "@/lib/domain";
import type { TreeNode } from "@/lib/types";
import { cn, formatNumber, plural } from "@/lib/utils";

export function TreeView() {
  const { state, hydrated, deleteNode, loadDemo } = useStore();
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
            Kategorie → podkategorie → metrika se záznamy.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNodeRequest({ kind: "category", parentId: null })}
        >
          <FolderPlus /> Kategorie
        </Button>
      </header>

      <Card className="p-1.5">
        {roots.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm font-medium">Zatím prázdno</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Založ kategorii (Business, Fitness), pod ni metriku s textem typu
              {" "}
              <span className="font-mono text-xs">X cold calls za den</span> a zapisuj.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setNodeRequest({ kind: "category", parentId: null })}
              >
                <FolderPlus /> Nová kategorie
              </Button>
              <Button size="sm" variant="outline" onClick={loadDemo}>
                <Sparkles /> Ukázková data
              </Button>
            </div>
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
  const { state, today } = useStore();
  const isOpen = expanded.has(node.id);
  const children = childrenOf(state.nodes, node.id);
  const isMetric = node.kind === "metric";
  const summary = isMetric ? summarizeMetric(state, node, today) : null;
  const hasBody = isMetric || children.length > 0;

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

        {isMetric ? (
          <Gauge className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
        )}

        <span
          className={cn(
            "min-w-0 truncate",
            isMetric ? "text-sm" : "text-sm font-medium",
          )}
          title={node.name}
        >
          {node.name}
        </span>

        {summary ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className="tabular">
              rekord{" "}
              {summary.record.value > 0 ? formatNumber(summary.record.value) : "—"}
              {summary.record.value > 0 && node.unit ? ` ${node.unit}` : ""}
            </Badge>
            {summary.todayTotal > 0 ? (
              <Badge variant={summary.hasMicrowinToday ? "win" : "default"} className="tabular">
                {summary.hasMicrowinToday ? <Trophy /> : null}
                dnes {formatNumber(summary.todayTotal)}
              </Badge>
            ) : null}
          </div>
        ) : (
          <CategoryBadge nodeId={node.id} />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {!isMetric ? (
            <>
              <IconAction
                label="Přidat podkategorii"
                onClick={() => onNodeRequest({ kind: "category", parentId: node.id })}
              >
                <FolderPlus />
              </IconAction>
              <IconAction
                label="Přidat metriku"
                onClick={() => onNodeRequest({ kind: "metric", parentId: node.id })}
              >
                <Gauge />
              </IconAction>
            </>
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

        {isMetric ? (
          <Button size="sm" className="ml-1 shrink-0" onClick={() => onAddEntry(node)}>
            <Plus /> Zápis
          </Button>
        ) : null}
      </div>

      {isOpen && isMetric ? (
        <div style={{ paddingLeft: depth * 18 + 34 }} className="pb-2 pr-2">
          <MetricEntries metric={node} />
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
      description="Smazání je nevratné - záznamy i microwiny podstromu zmizí."
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
