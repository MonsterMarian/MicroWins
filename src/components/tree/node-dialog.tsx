"use client";

import * as React from "react";
import { CheckSquare, FolderPlus, Gauge, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { formatDate } from "@/lib/date";
import { formatMetricLabel, hasPlaceholder, onceEntry } from "@/lib/domain";
import type { Aggregation, NodeKind, TreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NodeDialogState {
  /** Předvolený druh. Při zakládání ho jde v dialogu přepnout. */
  kind: NodeKind;
  parentId: string | null;
  /** Vyplněno = editace, prázdné = nový uzel. */
  node?: TreeNode;
}

const KINDS: { kind: NodeKind; label: string; hint: string; icon: React.ElementType }[] = [
  { kind: "category", label: "Složka", hint: "obsahuje další winy", icon: FolderPlus },
  { kind: "metric", label: "Číslo", hint: "honí se rekord", icon: Gauge },
  { kind: "check", label: "Zaškrtnutí", hint: "opakuje se, bez čísla", icon: CheckSquare },
  { kind: "once", label: "Jednorázový", hint: "stane se jednou", icon: Star },
];

export function NodeDialog({
  request,
  onOpenChange,
}: {
  request: NodeDialogState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, today, addCategory, addMetric, addCheck, addOnce, updateNode, updateOnce } =
    useStore();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<NodeKind>("metric");
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [aggregation, setAggregation] = React.useState<Aggregation>("sum");
  const [date, setDate] = React.useState(today);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Formulář se plní jen při otevření dialogu - přes ref, aby ho zápis jinde
  // uprostřed psaní nepřepsal.
  const entriesRef = React.useRef(state.entries);
  entriesRef.current = state.entries;

  React.useEffect(() => {
    if (!request) return;
    const existing =
      request.node?.kind === "once" ? onceEntry(entriesRef.current, request.node.id) : undefined;
    setKind(request.node?.kind ?? request.kind);
    setName(request.node?.name ?? "");
    setUnit(request.node?.unit ?? "");
    setAggregation(request.node?.aggregation ?? "sum");
    setDate(existing?.date ?? today);
    setNote(existing?.note ?? "");
    setError(null);
  }, [request, today]);

  if (!request) return null;

  const isEdit = Boolean(request.node);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Název nesmí být prázdný.");
      return;
    }

    if (isEdit && request.node) {
      if (kind === "metric") updateNode(request.node.id, { name: trimmed, unit, aggregation });
      else if (kind === "once") updateOnce(request.node.id, { name: trimmed, date, note });
      else updateNode(request.node.id, { name: trimmed });
    } else if (kind === "metric") {
      addMetric(request.parentId, { name: trimmed, unit, aggregation });
    } else if (kind === "check") {
      addCheck(request.parentId, trimmed);
    } else if (kind === "once") {
      addOnce(request.parentId, { name: trimmed, date, note });
      toast({
        tone: date === today ? "win" : "info",
        title: date === today ? `Microwin! ${trimmed}` : `Zapsáno k ${formatDate(date)}`,
        description: "Jednorázový win - zapíše se jednou a je hotový.",
      });
    } else {
      addCategory(request.parentId, trimmed);
    }
    onOpenChange(false);
  };

  const TITLES: Record<NodeKind, [create: string, edit: string]> = {
    category: ["Nová složka", "Přejmenovat složku"],
    metric: ["Nový číselný win", "Upravit číselný win"],
    check: ["Nové zaškrtnutí", "Upravit zaškrtnutí"],
    once: ["Nový jednorázový win", "Upravit jednorázový win"],
  };
  const DESCRIPTIONS: Record<NodeKind, string> = {
    category: "Složka může obsahovat další složky i všechny druhy winů.",
    metric: "Text s X a číselné záznamy. Microwin padne, když překonáš rekord.",
    check: "Jen ANO/NE. Každý zaškrtnutý den je microwin - nic se nekvantifikuje.",
    once: "Poznámka k jednomu dni. Zapíše se jednou, neopakuje se.",
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={TITLES[kind][isEdit ? 1 : 0]}
      description={DESCRIPTIONS[kind]}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={submit}>{isEdit ? "Uložit" : "Vytvořit"}</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!isEdit ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((k) => {
              const Icon = k.icon;
              const active = kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => setKind(k.kind)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors",
                    active
                      ? "border-foreground/40 bg-accent"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="text-xs font-medium">{k.label}</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{k.hint}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <Field
          label={kind === "metric" ? "Text s X" : kind === "category" ? "Název" : "Text winu"}
          htmlFor="node-name"
          hint={kind === "metric" ? "X se v přehledech nahradí hodnotou daného dne." : undefined}
        >
          <Input
            id="node-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder={
              kind === "metric"
                ? "X cold calls za den"
                : kind === "check"
                  ? "Ranní protažení"
                  : kind === "once"
                    ? "Odeslal jsem první nabídku"
                    : "Business"
            }
            autoComplete="off"
          />
        </Field>

        {kind === "metric" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Jednotka (nepovinné)" htmlFor="node-unit">
                <Input
                  id="node-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="H, km, ks"
                  autoComplete="off"
                />
              </Field>
              <Field label="Více záznamů za den" htmlFor="node-agg">
                <Select
                  id="node-agg"
                  value={aggregation}
                  onChange={(e) => setAggregation(e.target.value as Aggregation)}
                >
                  <option value="sum">sečíst (2 + 3 = 5)</option>
                  <option value="max">nejlepší pokus (max)</option>
                </Select>
              </Field>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Ukázka zápisu s hodnotou 4:</p>
              <p className="mt-1 font-medium">
                {name.trim() ? formatMetricLabel(name, 4, unit.trim() || undefined) : "—"}
              </p>
              {name.trim() && !hasPlaceholder(name) ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Text neobsahuje X, hodnota se dá automaticky dopředu.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {kind === "once" ? (
          <>
            <Field label="Kdy se to stalo" htmlFor="node-date">
              <Input
                id="node-date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value || today)}
              />
            </Field>
            <Field label="Poznámka (nepovinné)" htmlFor="node-note">
              <Textarea
                id="node-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="kontext, který si za rok nevybavíš"
              />
            </Field>
          </>
        ) : null}

        {kind === "check" ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Ve stromu se pak jen zaškrtává. Každý odškrtnutý den je microwin, i když
            dohnaný zpětně - buď se to ten den stalo, nebo ne.
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Dialog>
  );
}
