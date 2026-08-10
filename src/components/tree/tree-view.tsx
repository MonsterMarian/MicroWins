"use client";

import * as React from "react";
import {
  ArrowLeft,
  Check,
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
 * Do složek se vchází, nerozbalují se - jinak se v tom s pár desítkami winů
 * nedá vyznat. Vidět je vždy jen obsah jedné složky; co je pod podsložkami,
 * je vidět až po vstupu do nich. Rozbalují se jen samotné winy (jejich
 * záznamy), protože ty už další úroveň nemají.
 */
export function TreeView() {
  const { state, deleteNode } = useStore();
  /** Otevřená složka; null = kořen. */
  const [folderId, setFolderId] = React.useState<string | null>(null);
  /** Rozbalené winy (ne složky) - záznamy pod řádkem. */
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [entryFor, setEntryFor] = React.useState<TreeNode | null>(null);
  const [nodeRequest, setNodeRequest] = React.useState<NodeDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<TreeNode | null>(null);
  const [settingsFor, setSettingsFor] = React.useState<TreeNode | null>(null);

  const trail = folderId ? pathOf(state.nodes, folderId) : [];

  // Otevřenou složku mohl smazat dialog uvnitř ní - pak by obrazovka zůstala
  // v neexistující cestě.
  React.useEffect(() => {
    if (folderId && !nodeById(state.nodes, folderId)) setFolderId(null);
  }, [folderId, state.nodes]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const items = childrenOf(state.nodes, folderId);
  const isRoot = folderId === null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight">Strom úspěchů</h2>

      <Card className="overflow-hidden p-0">
        <FolderBar
          trail={trail}
          onOpen={setFolderId}
          onAddFolder={() => setNodeRequest({ kind: "category", parentId: folderId })}
          onAddWin={() => setNodeRequest({ kind: "metric", parentId: folderId })}
        />

        {items.length === 0 ? (
          <EmptyFolder
            isRoot={isRoot}
            onAddFolder={() => setNodeRequest({ kind: "category", parentId: folderId })}
            onAddWin={() => setNodeRequest({ kind: "metric", parentId: folderId })}
          />
        ) : (
          <ul className="p-1.5">
            {items.map((node) =>
              node.kind === "category" ? (
                <FolderRow
                  key={node.id}
                  node={node}
                  onOpen={setFolderId}
                  onSettings={setSettingsFor}
                  onNodeRequest={setNodeRequest}
                  onDelete={setPendingDelete}
                />
              ) : (
                <WinRow
                  key={node.id}
                  node={node}
                  open={expanded.has(node.id)}
                  onToggle={toggle}
                  onAddEntry={setEntryFor}
                  onNodeRequest={setNodeRequest}
                  onDelete={setPendingDelete}
                />
              ),
            )}
          </ul>
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
 * Lišta složky: cesta zpět a obě zakládací tlačítka. Je v každé složce, takže
 * se nová složka i nový win dají založit rovnou tam, kde stojím.
 */
function FolderBar({
  trail,
  onOpen,
  onAddFolder,
  onAddWin,
}: {
  trail: TreeNode[];
  onOpen: (id: string | null) => void;
  onAddFolder: () => void;
  onAddWin: () => void;
}) {
  const parent = trail.length > 1 ? trail[trail.length - 2].id : null;

  return (
    <div className="flex items-center gap-1 border-b bg-muted/30 px-1.5 py-1.5">
      {trail.length > 0 ? (
        <IconAction label="O úroveň výš" onClick={() => onOpen(parent)}>
          <ArrowLeft />
        </IconAction>
      ) : (
        <span className="grid size-7 shrink-0 place-items-center text-muted-foreground">
          <ListTree className="size-4" />
        </span>
      )}

      {/* Dlouhá cesta se v úzkém okně odscrolluje, nesmí rozhodit lištu. */}
      <nav
        aria-label="Cesta ve stromu"
        className="scroll-quiet flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-sm"
      >
        <Crumb label="Vše" active={trail.length === 0} onClick={() => onOpen(null)} />
        {trail.map((node, i) => (
          <React.Fragment key={node.id}>
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
            <Crumb
              label={node.name}
              active={i === trail.length - 1}
              onClick={() => onOpen(node.id)}
            />
          </React.Fragment>
        ))}
      </nav>

      <IconAction label="Nová složka" onClick={onAddFolder}>
        <FolderPlus />
      </IconAction>
      <Button size="icon-sm" aria-label="Nový win" title="Nový win" onClick={onAddWin}>
        <Plus />
      </Button>
    </div>
  );
}

function Crumb({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 transition-colors",
        active
          ? "font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function EmptyFolder({
  isRoot,
  onAddFolder,
  onAddWin,
}: {
  isRoot: boolean;
  onAddFolder: () => void;
  onAddWin: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-sm font-medium">{isRoot ? "Zatím prázdno" : "Ve složce nic není"}</p>
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

/** Řádek složky: levá část se dá klepnout a vejde se dovnitř. */
function FolderRow({
  node,
  onOpen,
  onSettings,
  onNodeRequest,
  onDelete,
}: {
  node: TreeNode;
  onOpen: (id: string) => void;
  onSettings: (node: TreeNode) => void;
  onNodeRequest: (req: NodeDialogState) => void;
  onDelete: (node: TreeNode) => void;
}) {
  const { state } = useStore();
  const wins = microwinsInSubtree(state, node.id);
  const count = childrenOf(state.nodes, node.id).length;

  return (
    <li>
      <div className="flex items-center gap-1 overflow-hidden rounded-md pr-1.5 transition-colors hover:bg-accent/60">
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-2 text-left"
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          {/* Na telefonu jde popis pod název - na jeden řádek se vedle tlačítek
              vejde tak sedm znaků a z názvu složky nezbude nic čitelného. */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{node.name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {wins > 0 ? (
                <Badge variant="outline" className="tabular">
                  {wins} {plural(wins, "microwin", "microwiny", "microwinů")}
                </Badge>
              ) : null}
              <span className="tabular text-xs text-muted-foreground">
                {count} {plural(count, "položka", "položky", "položek")}
              </span>
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction label="Nastavení složky" onClick={() => onSettings(node)}>
            <Settings2 />
          </IconAction>
          <IconAction
            label="Přejmenovat"
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
}: {
  node: TreeNode;
  open: boolean;
  onToggle: (id: string) => void;
  onAddEntry: (metric: TreeNode) => void;
  onNodeRequest: (req: NodeDialogState) => void;
  onDelete: (node: TreeNode) => void;
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
      <div className="flex items-center gap-1.5 overflow-hidden rounded-md py-1.5 pl-1 pr-1.5 transition-colors hover:bg-accent/60">
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-label={open ? "Sbalit" : "Rozbalit"}
          aria-expanded={open}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>

        <KindIcon node={node} />

        {/* Stejně jako u složek: na úzkém displeji patří odznaky pod název,
            jinak by z názvu winu zbylo pár písmen. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
          <span className="min-w-0 truncate text-sm" title={node.name}>
            {node.name}
          </span>

          {node.kind === "metric" ? <MetricBadges node={node} /> : null}
          {node.kind === "check" && check ? <CheckBadges summary={check} /> : null}
          {node.kind === "once" ? <OnceBadge node={node} /> : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
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

function KindIcon({ node }: { node: TreeNode }) {
  if (node.kind === "metric") return <Gauge className="size-3.5 shrink-0 text-muted-foreground" />;
  if (node.kind === "check") return <Check className="size-3.5 shrink-0 text-muted-foreground" />;
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
    <div className="flex shrink-0 items-center">
      <Badge variant="outline" className="tabular">
        {entry ? formatDate(entry.date) : "bez data"}
      </Badge>
    </div>
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
      description="Přesun bere celý obsah složky včetně podsložek."
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
          <Select
            id="folder-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Vše (kořen stromu)</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
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
