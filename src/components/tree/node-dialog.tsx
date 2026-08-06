"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { formatMetricLabel, hasPlaceholder } from "@/lib/domain";
import type { Aggregation, TreeNode } from "@/lib/types";

export interface NodeDialogState {
  kind: "category" | "metric";
  parentId: string | null;
  /** Vyplněno = editace, prázdné = nový uzel. */
  node?: TreeNode;
}

export function NodeDialog({
  request,
  onOpenChange,
}: {
  request: NodeDialogState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { addCategory, addMetric, updateNode } = useStore();
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [aggregation, setAggregation] = React.useState<Aggregation>("sum");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!request) return;
    setName(request.node?.name ?? "");
    setUnit(request.node?.unit ?? "");
    setAggregation(request.node?.aggregation ?? "sum");
    setError(null);
  }, [request]);

  if (!request) return null;

  const isMetric = request.kind === "metric";
  const isEdit = Boolean(request.node);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Název nesmí být prázdný.");
      return;
    }
    if (isEdit && request.node) {
      updateNode(request.node.id, isMetric ? { name: trimmed, unit, aggregation } : { name: trimmed });
    } else if (isMetric) {
      addMetric(request.parentId, { name: trimmed, unit, aggregation });
    } else {
      addCategory(request.parentId, trimmed);
    }
    onOpenChange(false);
  };

  const title = isEdit
    ? isMetric
      ? "Upravit metriku"
      : "Přejmenovat kategorii"
    : isMetric
      ? "Nová metrika"
      : "Nová kategorie";

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={title}
      description={
        isMetric
          ? "Metrika je list stromu - drží text s X a jednotlivé záznamy."
          : "Kategorie může obsahovat další kategorie i metriky."
      }
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
        <Field
          label={isMetric ? "Text s X" : "Název"}
          htmlFor="node-name"
          hint={
            isMetric
              ? "X se v přehledech nahradí hodnotou daného dne."
              : undefined
          }
        >
          <Input
            id="node-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder={isMetric ? "X cold calls za den" : "Business"}
            autoComplete="off"
          />
        </Field>

        {isMetric ? (
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

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Dialog>
  );
}
