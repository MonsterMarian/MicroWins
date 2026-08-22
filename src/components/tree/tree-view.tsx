"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Gauge,
  ListTree,
  Pencil,
  Plus,
  Settings2,
  Square,
  Star,
  Trash2,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EntityIcon } from "@/components/ui/icon-picker";
import { SortableItem, SortableList } from "@/components/ui/sortable";
import { Field, Select } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { EntryDialog } from "./entry-dialog";
import { CheckEntries, MetricEntries, OnceDetail } from "./metric-entries";
import { NodeDialog, type NodeDialogState } from "./node-dialog";
import { moveTargets } from "@/lib/actions";
import { formatDate } from "@/lib/date";
import { tapFeedback, winFeedback } from "@/lib/native";
import {
  childrenOf,
  microwinsInSubtree,
  nodeById,
  onceEntry,
  pathOf,
  subtreeIds,
  summarizeFlag,
  summarizeMetric,
} from "@/lib/domain";
import type { TreeNode } from "@/lib/types";
import { cn, formatNumber, plural } from "@/lib/utils";

/**
 * Strom úspěchů.
 *
 * Složky se rozbalují na místě chevronem ▶ / ▼. Na začátku jsou vidět jen
 * root uzly; uživatel si rozbalí, co potřebuje. Přetahování mění jen pořadí
 * sourozenců ve stejné složce - přesuny mezi složkami jdou přes dialog ⚙️.
 */
export function TreeView() {
  const { state, deleteNode } = useStore();
  /** Rozbalené složky (jejich ID). */
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set());
  /** Rozbalené winy (záznamy pod řádkem). */
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [entryFor, setEntryFor] = React.useState<TreeNode | null>(null);
  const [nodeRequest, setNodeRequest] = React.useState<NodeDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<TreeNode | null>(null);
  const [settingsFor, setSettingsFor] = React.useState<TreeNode | null>(null);

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleWin = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rootItems = childrenOf(state.nodes, null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight">Strom úspěchů</h2>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-1 border-b bg-muted/30 px-1.5 py-1.5">
          <span className="grid size-7 shrink-0 place-items-center text-muted-foreground">
            <ListTree className="size-4" />
          </span>
          <span className="flex-1 text-sm font-medium">Vše</span>
          <IconAction label="Nová složka" onClick={() => setNodeRequest({ kind: "category", parentId: null })}>
            <FolderPlus />
          </IconAction>
          <Button size="icon-sm" aria-label="Nový win" title="Nový win" onClick={() => setNodeRequest({ kind: "metric", parentId: null })}>
            <Plus />
          </Button>
        </div>

        {rootItems.length === 0 ? (
          <EmptyFolder
            onAddFolder={() => setNodeRequest({ kind: "category", parentId: null })}
            onAddWin={() => setNodeRequest({ kind: "metric", parentId: null })}
          />
        ) : (
          <TreeLevel
            parentId={null}
            depth={0}
            expandedFolders={expandedFolders}
            expandedWins={expanded}
            onToggleFolder={toggleFolder}
            onToggleWin={toggleWin}
            onAddEntry={setEntryFor}
            onNodeRequest={setNodeRequest}
            onDelete={setPendingDelete}
            onSettings={setSettingsFor}
          />
        )}
      </Card>

      <EntryDialog
        metric={entryFor}
        open={entryFor !== null}
        onOpenChange={(open) => !open && setEntryFor(null)}
      />
      <NodeDialog request={nodeRequest} onOpenChange={(open) => !open && setNodeRequest(null)} />

      {settingsFor ? (
        <FolderSettingsDialog node={settingsFor} onClose={() => setSettingsFor(null)} />
      ) : null}

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

/**
 * Jedna úroveň stromu: sortable seznam sourozenců s odsazením podle hloubky.
 * Složky se rozbalují na místě, winy ukazují záznamy.
 */
function TreeLevel({
  parentId,
  depth,
  expandedFolders,
  expandedWins,
  onToggleFolder,
  onToggleWin,
  onAddEntry,
  onNodeRequest,
  onDelete,
  onSettings,
}: {
  parentId: string | null;
  depth: number;
  expandedFolders: Set<string>;
  expandedWins: Set<string>;
  onToggleFolder: (id: string) => void;
  onToggleWin: (id: string) => void;
  onAddEntry: (metric: TreeNode) => void;
  onNodeRequest: (req: NodeDialogState) => void;
  onDelete: (node: TreeNode) => void;
  onSettings: (node: TreeNode) => void;
}) {
  const { state, reorderNodes } = useStore();
  const items = childrenOf(state.nodes, parentId);

  if (items.length === 0) return null;

  return (
    <SortableList
      ids={items.map((i) => i.id)}
      onReorder={reorderNodes}
      className="p-1.5 flex flex-col gap-0.5"
    >
      {items.map((node) => (
        <SortableItem key={node.id} id={node.id}>
          {node.kind === "category" ? (
            <>
              <FolderRow
                node={node}
                open={expandedFolders.has(node.id)}
                onToggle={onToggleFolder}
                onSettings={onSettings}
                onNodeRequest={onNodeRequest}
                onDelete={onDelete}
              />
              {expandedFolders.has(node.id) ? (
                <div className="ml-4 border-l border-border/40">
                  <TreeLevel
                    parentId={node.id}
                    depth={depth + 1}
                    expandedFolders={expandedFolders}
                    expandedWins={expandedWins}
                    onToggleFolder={onToggleFolder}
                    onToggleWin={onToggleWin}
                    onAddEntry={onAddEntry}
                    onNodeRequest={onNodeRequest}
                    onDelete={onDelete}
                    onSettings={onSettings}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <WinRow
              node={node}
              open={expandedWins.has(node.id)}
              onToggle={onToggleWin}
              onAddEntry={onAddEntry}
              onNodeRequest={onNodeRequest}
              onDelete={onDelete}
              onSettings={onSettings}
            />
          )}
        </SortableItem>
      ))}
    </SortableList>
  );
}

function EmptyFolder({
  onAddFolder,
  onAddWin,
}: {
  onAddFolder: () => void;
  onAddWin: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-sm font-medium">Zatím prázdno</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Založ složku (Business, Fitness) a pod ni win: číselný (
        <span className="font-mono text-xs">X cold calls za den</span>), zaškrtávací (Ranní
        protažení) nebo jednorázový.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onAddFolder}>
          <FolderPlus /> Nová složka
        </Button>
        <Button size="sm" onClick={onAddWin}>
          <Plus /> Nový win
        </Button>
      </div>
    </div>
  );
}

/** Řádek složky: klik rozbalí/sbalí, chevron ukazuje stav. */
function FolderRow({
  node,
  open,
  onToggle,
  onSettings,
  onNodeRequest,
  onDelete,
}: {
  node: TreeNode;
  open: boolean;
  onToggle: (id: string) => void;
  onSettings: (node: TreeNode) => void;
  onNodeRequest: (req: NodeDialogState) => void;
  onDelete: (node: TreeNode) => void;
}) {
  const { state } = useStore();
  const wins = microwinsInSubtree(state, node.id);

  return (
    <li>
      <div className="flex items-center gap-1 overflow-hidden rounded-md pr-1.5 transition-colors hover:bg-accent/60">
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <FolderIcon node={node} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{node.name}</span>
            {wins > 0 ? (
              <span className="tabular shrink-0 text-xs text-muted-foreground">
                {wins} {plural(wins, "microwin", "microwiny", "microwinů")}
              </span>
            ) : null}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction label="Nastavení složky" onClick={() => onSettings(node)}>
            <Settings2 />
          </IconAction>
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
      </div>
    </li>
  );
}

/** Řádek winu: rozbaluje se na místě, hlavní akce je vpravo jako jeden znak. */
function WinRow({
  node,
  open,
  onToggle,
  onAddEntry,
  onNodeRequest,
  onDelete,
  onSettings,
}: {
  node: TreeNode;
  open: boolean;
  onToggle: (id: string) => void;
  onAddEntry: (metric: TreeNode) => void;
  onNodeRequest: (req: NodeDialogState) => void;
  onDelete: (node: TreeNode) => void;
  onSettings: (node: TreeNode) => void;
}) {
  const { state, today, toggleCheck } = useStore();
  const { toast } = useToast();
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
      <div className="flex items-center gap-1 overflow-hidden rounded-md pr-1.5 transition-colors hover:bg-accent/60">
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 text-left"
        >
          <KindIcon node={node} />

          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
            <span className="min-w-0 truncate text-sm" title={node.name}>
              {node.name}
            </span>

            {node.kind === "metric" ? <MetricBadges node={node} /> : null}
            {node.kind === "check" && check ? <CheckBadges summary={check} /> : null}
            {node.kind === "once" ? <OnceBadge node={node} /> : null}
          </span>

          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction label="Nastavení (přesun)" onClick={() => onSettings(node)}>
            <Settings2 />
          </IconAction>
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
          <Button
            size="icon-sm"
            className="ml-0.5 shrink-0"
            aria-label="Nový zápis"
            title="Nový zápis"
            onClick={() => onAddEntry(node)}
          >
            <Plus />
          </Button>
        ) : null}

        {node.kind === "check" && check ? (
          <Button
            size="icon-sm"
            variant={check.doneToday ? "win" : "outline"}
            className="ml-0.5 shrink-0"
            aria-pressed={check.doneToday}
            aria-label={check.doneToday ? "Odškrtnout dnešek" : "Zaškrtnout dnešek"}
            title={check.doneToday ? "Odškrtnout dnešek" : "Zaškrtnout dnešek"}
            onClick={onCheck}
          >
            {check.doneToday ? <Check /> : <Square />}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="pb-2 pl-8 pr-2">
          {node.kind === "metric" ? <MetricEntries metric={node} /> : null}
          {node.kind === "check" ? <CheckEntries node={node} /> : null}
          {node.kind === "once" ? <OnceDetail node={node} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Ikona složky. Vlastní ikona se kreslí naplno, protože ji uživatel vybral
 * proto, aby šla poznat; složka bez ikony zůstává tlumeným `Folder` jako dřív,
 * takže se strom bez jediné vybrané ikony nezmění.
 */
function FolderIcon({ node }: { node: TreeNode }) {
  if (!node.icon) return <Folder className="size-4 shrink-0 text-muted-foreground" />;
  // `text-base` je kvůli emoji: to nemá vlastní velikost jako kreslená ikona
  // a v tenhle text-sm kontextu by vyšlo o dva pixely menší než sousedi.
  return <EntityIcon icon={node.icon} size="sm" className="shrink-0 text-base leading-none" />;
}

/* Stejná velikost jako složková ikona - jinak by se sloupec s ikonami mezi
   oběma typy řádků o dva pixely rozjel a šipky vpravo by nesouhlasily. */
function KindIcon({ node }: { node: TreeNode }) {
  if (node.kind === "metric") return <Gauge className="size-4 shrink-0 text-muted-foreground" />;
  if (node.kind === "check") return <Check className="size-4 shrink-0 text-muted-foreground" />;
  if (node.kind === "once") return <Star className="size-4 shrink-0 text-muted-foreground" />;
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />;
}

function MetricBadges({ node }: { node: TreeNode }) {
  const { state, today } = useStore();
  const summary = summarizeMetric(state, node, today);

  return (
    <span className="flex shrink-0 items-center gap-1.5">
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
    </span>
  );
}

function CheckBadges({ summary }: { summary: ReturnType<typeof summarizeFlag> }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
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
    </span>
  );
}

function OnceBadge({ node }: { node: TreeNode }) {
  const { state } = useStore();
  const entry = onceEntry(state.entries, node.id);

  return (
    <span className="flex shrink-0 items-center">
      <Badge variant="outline" className="tabular">
        {entry ? formatDate(entry.date) : "bez data"}
      </Badge>
    </span>
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
        "shrink-0 text-muted-foreground",
        destructive ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

/**
 * Nastavení složky. Zatím jen přesun - do vlastní podsložky to nejde, tím by
 * se strom zacyklil.
 */
function FolderSettingsDialog({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  const { state, moveNode } = useStore();
  const { toast } = useToast();
  const [target, setTarget] = React.useState(node.parentId ?? "");

  const targets = React.useMemo(() => {
    return moveTargets(state, node.id)
      .map((n) => ({
        id: n.id,
        label: pathOf(state.nodes, n.id)
          .map((p) => p.name)
          .join(" / "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "cs"));
  }, [state, node.id]);

  const inside = childrenOf(state.nodes, node.id).length;
  const unchanged = (target || null) === node.parentId;

  const submit = () => {
    const to = target || null;
    moveNode(node.id, to);
    const name = to ? (nodeById(state.nodes, to)?.name ?? "") : "Vše";
    toast({ tone: "info", title: "Složka přesunuta", description: `${node.name} → ${name}` });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Nastavení "${node.name}"`}
      description={node.kind === "category" ? "Přesun bere celý obsah složky včetně podsložek." : "Přesun objektu do jiné složky."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button disabled={unchanged} onClick={submit}>
            Přesunout
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Umístit do složky"
          htmlFor="folder-target"
          hint={
            inside > 0
              ? `Pojede s ní ${inside} ${plural(inside, "položka", "položky", "položek")}.`
              : "Složka je prázdná."
          }
        >
          <FolderSelectTree
            nodes={state.nodes}
            validTargets={new Set(targets.map((t) => t.id))}
            value={target}
            onChange={setTarget}
          />
        </Field>

        {targets.length === 0 ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Jiná složka, kam by šla přesunout, zatím není - vlastní podsložky to logicky
            nemůžou být.
          </p>
        ) : null}
      </div>
    </Dialog>
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

function FolderSelectTree({
  nodes,
  validTargets,
  value,
  onChange,
}: {
  nodes: TreeNode[];
  validTargets: Set<string>;
  value: string;
  onChange: (id: string) => void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col rounded-md border border-input bg-background overflow-hidden max-h-[40vh] overflow-y-auto">
      <button
        type="button"
        onClick={() => onChange("")}
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
          value === "" ? "bg-accent font-medium text-foreground" : "hover:bg-accent/50"
        )}
      >
        <ListTree className="size-4 shrink-0 text-muted-foreground" />
        Vše (kořen stromu)
      </button>
      <FolderSelectLevel
        parentId={null}
        nodes={nodes}
        validTargets={validTargets}
        value={value}
        onChange={onChange}
        expanded={expanded}
        onToggle={toggle}
        depth={0}
      />
    </div>
  );
}

function FolderSelectLevel({
  parentId,
  nodes,
  validTargets,
  value,
  onChange,
  expanded,
  onToggle,
  depth,
}: {
  parentId: string | null;
  nodes: TreeNode[];
  validTargets: Set<string>;
  value: string;
  onChange: (id: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
}) {
  const children = childrenOf(nodes, parentId)
    .filter((n) => n.kind === "category" && validTargets.has(n.id));

  if (children.length === 0) return null;

  return (
    <div className="flex flex-col">
      {children.map((node) => {
        const isOpen = expanded.has(node.id);
        const isSelected = value === node.id;
        const hasValidChildren = childrenOf(nodes, node.id).some(
          (c) => c.kind === "category" && validTargets.has(c.id)
        );

        return (
          <React.Fragment key={node.id}>
            <div
              className={cn(
                "flex items-center gap-1 px-1 transition-colors text-left",
                isSelected ? "bg-accent text-foreground" : "hover:bg-accent/50"
              )}
            >
              {hasValidChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.id)}
                  className="p-1.5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
              ) : (
                <div className="w-6.5 shrink-0" />
              )}
              
              <button
                type="button"
                onClick={() => onChange(node.id)}
                className={cn(
                  "flex flex-1 items-center gap-2 py-2 pr-2 text-sm min-w-0",
                  isSelected && "font-medium"
                )}
                style={{ paddingLeft: !hasValidChildren ? "0.375rem" : undefined }}
              >
                <FolderIcon node={node} />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
            
            {isOpen && hasValidChildren && (
              <div className="flex flex-col border-l border-border/40" style={{ marginLeft: `${(depth + 1) * 1.5}rem` }}>
                <FolderSelectLevel
                  parentId={node.id}
                  nodes={nodes}
                  validTargets={validTargets}
                  value={value}
                  onChange={onChange}
                  expanded={expanded}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
