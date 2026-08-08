"use client";

import * as React from "react";
import { CalendarClock, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { formatDate } from "@/lib/date";
import {
  aggregationOf,
  entriesOfMetric,
  evaluate,
  formatMetricLabel,
  recordOf,
  type Evaluation,
} from "@/lib/domain";
import { tapFeedback, winFeedback } from "@/lib/native";
import type { Entry, TreeNode } from "@/lib/types";
import { formatNumber, parseNumber } from "@/lib/utils";

export function EntryDialog({
  metric,
  open,
  onOpenChange,
}: {
  metric: TreeNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, today, addEntry } = useStore();
  const { toast } = useToast();
  const [value, setValue] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setValue("");
      setDate(today);
      setNote("");
      setError(null);
    }
  }, [open, today, metric?.id]);

  const preview = React.useMemo<Evaluation | null>(() => {
    if (!metric) return null;
    const parsed = parseNumber(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const existing = entriesOfMetric(state.entries, metric.id);
    const fake: Entry = {
      id: "__preview__",
      metricId: metric.id,
      date,
      value: parsed,
      createdAt: "",
      backdated: date !== today,
    };
    return evaluate({
      entries: [...existing, fake],
      date,
      value: parsed,
      aggregation: aggregationOf(metric),
      today,
    });
  }, [metric, state.entries, value, date, today]);

  if (!metric) return null;

  const aggregation = aggregationOf(metric);
  const existing = entriesOfMetric(state.entries, metric.id);
  const record = recordOf(existing, aggregation);

  const submit = () => {
    const parsed = parseNumber(value);
    const res = addEntry({ metricId: metric.id, value: parsed, date, note });

    if (res.evaluation.status === "invalid") {
      setError(res.evaluation.message ?? "Zápis se nepovedl.");
      return;
    }
    if (res.evaluation.status === "ignored-zero") {
      setError("Nula se nezapisuje - zapiš víc než 0.");
      return;
    }

    const label = formatMetricLabel(metric.name, res.evaluation.dayTotal, metric.unit);
    void (res.evaluation.isMicrowin ? winFeedback() : tapFeedback());

    if (res.evaluation.isMicrowin) {
      toast({
        tone: "win",
        title: res.improved ? `Microwin vylepšen: ${label}` : `Microwin! ${label}`,
        description: res.evaluation.isFirstEver
          ? "První zápis metriky - rekord je na světě."
          : `Předchozí rekord: ${formatNumber(res.evaluation.previousRecord)}`,
      });
    } else if (res.evaluation.beatsRecord) {
      toast({
        tone: "info",
        title: `Rekord posunut na ${formatNumber(res.evaluation.dayTotal)}`,
        description: `Zpětný zápis k ${formatDate(date)} - microwin se počítá jen k dnešku.`,
      });
    } else if (res.revoked) {
      toast({
        tone: "warn",
        title: "Dnešní microwin padl",
        description: "Zpětný zápis posunul rekord nad dnešní výkon.",
      });
    } else {
      const missing = res.evaluation.previousRecord - res.evaluation.dayTotal;
      toast({
        tone: "info",
        title: `Zapsáno: ${label}`,
        description:
          missing > 0
            ? `Do rekordu chybí ${formatNumber(missing)}.`
            : "Rekord zůstává, ale zápis se počítá.",
      });
    }

    onOpenChange(false);
  };

  const backdated = date !== today;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nový záznam"
      description={metric.name}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button variant={preview?.isMicrowin ? "win" : "default"} onClick={submit}>
            {preview?.isMicrowin ? <Trophy /> : null} Zapsat
          </Button>
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
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={metric.unit ? `Hodnota (${metric.unit})` : "Hodnota"}
            htmlFor="entry-value"
          >
            <Input
              id="entry-value"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              inputMode="decimal"
              placeholder="např. 4 nebo 2,5"
              autoComplete="off"
            />
          </Field>
          <Field label="Datum" htmlFor="entry-date">
            <Input
              id="entry-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value || today)}
            />
          </Field>
        </div>

        <Field label="Poznámka (nepovinné)" htmlFor="entry-note">
          <Input
            id="entry-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="kontext, který si za měsíc nevybavíš"
            autoComplete="off"
          />
        </Field>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Rekord</span>
            <span className="tabular font-medium">
              {record.value > 0
                ? `${formatNumber(record.value)}${record.date ? ` · ${formatDate(record.date)}` : ""}`
                : "zatím žádný"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">
              {backdated ? `Součet dne ${formatDate(date)}` : "Dnešní součet po zápisu"}
            </span>
            <span className="tabular font-medium">
              {preview ? formatNumber(preview.dayTotal) : "—"}
            </span>
          </div>

          {preview?.isMicrowin ? (
            <p className="mt-2 flex items-center gap-1.5 rounded-md bg-win-muted px-2 py-1.5 text-xs font-medium text-win-muted-foreground">
              <Trophy className="size-3.5" />
              Tohle bude microwin: {formatMetricLabel(metric.name, preview.dayTotal, metric.unit)}
            </p>
          ) : null}

          {backdated ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              Zpětný zápis - rekord posunout může, microwin za dnešek ne.
            </p>
          ) : null}

          {aggregation === "max" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Metrika počítá nejlepší pokus dne, ne součet.
            </p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Dialog>
  );
}
