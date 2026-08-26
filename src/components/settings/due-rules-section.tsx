"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { usePrefs, setPrefs } from "@/components/providers/use-prefs";
import { DAY_NAMES } from "@/lib/date";
import {
  blankDueRule,
  describeDueRule,
  DUE_RULE_KINDS,
  DUE_RULE_LABEL_MAX,
  DUE_RULE_MAX,
  isValidRuleTime,
  resolveDueRule,
  type DueRule,
  type DueRuleKind,
} from "@/lib/due-rules";
import { formatDue } from "@/lib/todos";
import { createId } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Rychlé termíny v ToDo.
 *
 * Tlačítka v dialogu termínu nejsou napevno: dá se přenastavit, co která
 * nabídka znamená („ráno" v devět nebo v šest), a přidat si vlastní. Proto
 * je tady seznam pravidel a ne čtyři pole s hodinami - „nejbližší sobota"
 * se čtyřmi poli popsat nedá.
 */
export function DueRulesSection() {
  const { dueRules } = usePrefs();
  const [editing, setEditing] = React.useState<DueRule | null>(null);
  const [isNew, setIsNew] = React.useState(false);
  const now = React.useMemo(() => new Date(), []);

  const save = (rule: DueRule) => {
    const next = dueRules.some((r) => r.id === rule.id)
      ? dueRules.map((r) => (r.id === rule.id ? rule : r))
      : [...dueRules, rule];
    setPrefs({ dueRules: next.slice(0, DUE_RULE_MAX) });
    setEditing(null);
  };

  const remove = (id: string) => {
    // Poslední tlačítko se nemaže - prázdná nabídka vypadá jako rozbitý dialog.
    if (dueRules.length <= 1) return;
    setPrefs({ dueRules: dueRules.filter((r) => r.id !== id) });
    setEditing(null);
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Rychlé termíny
      </h3>

      <div className="flex flex-col gap-1.5">
        {dueRules.map((rule) => {
          const at = resolveDueRule(rule, now);
          return (
            <div
              key={rule.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{rule.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {describeDueRule(rule)} · teď by vyšlo na {formatDue(at.date, at.time, now)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Upravit ${rule.label}`}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIsNew(false);
                  setEditing(rule);
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Smazat ${rule.label}`}
                disabled={dueRules.length <= 1}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove(rule.id)}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>

      {dueRules.length < DUE_RULE_MAX ? (
        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          onClick={() => {
            setIsNew(true);
            setEditing(blankDueRule(createId("rule")));
          }}
        >
          <Plus /> Přidat tlačítko
        </Button>
      ) : null}

      <p className="px-1 text-xs text-muted-foreground">
        Tlačítka se ukazují v ToDo pod polem s datem. „Nejbližší den v týdnu" počítá i dnešek -
        dokud zadaná hodina ještě nebyla.
      </p>

      {editing ? (
        <RuleDialog
          rule={editing}
          isNew={isNew}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function RuleDialog({
  rule,
  isNew,
  onSave,
  onClose,
}: {
  rule: DueRule;
  isNew: boolean;
  onSave: (rule: DueRule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState<DueRule>(rule);
  const now = React.useMemo(() => new Date(), []);
  const at = resolveDueRule(draft, now);
  const valid = draft.label.trim().length > 0;

  const set = (patch: Partial<DueRule>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={isNew ? "Nové tlačítko" : "Upravit tlačítko"}
      description="Co bude na tlačítku a jaký termín z něj vyjde."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button
            disabled={!valid}
            onClick={() => onSave({ ...draft, label: draft.label.trim() })}
          >
            Uložit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Text na tlačítku" htmlFor="rule-label">
          <Input
            id="rule-label"
            value={draft.label}
            maxLength={DUE_RULE_LABEL_MAX}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="V sobotu ráno"
            autoComplete="off"
          />
        </Field>

        <Field label="Jak se termín spočítá" htmlFor="rule-kind">
          <Select
            id="rule-kind"
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value as DueRuleKind })}
          >
            {DUE_RULE_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label} - {k.hint}
              </option>
            ))}
          </Select>
        </Field>

        {draft.kind === "offset" ? (
          <Field label="Za kolik minut" htmlFor="rule-minutes" hint="60 = za hodinu">
            <Input
              id="rule-minutes"
              inputMode="numeric"
              value={String(draft.minutes)}
              onChange={(e) => set({ minutes: Math.max(1, Number(e.target.value) || 0) })}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {draft.kind === "day" ? (
              <Field label="Za kolik dní" htmlFor="rule-days" hint="0 = dnes, 1 = zítra">
                <Input
                  id="rule-days"
                  inputMode="numeric"
                  value={String(draft.days)}
                  onChange={(e) => set({ days: Math.max(0, Number(e.target.value) || 0) })}
                />
              </Field>
            ) : (
              <Field label="Den v týdnu" htmlFor="rule-weekday">
                <Select
                  id="rule-weekday"
                  value={String(draft.weekday)}
                  onChange={(e) => set({ weekday: Number(e.target.value) })}
                >
                  {DAY_NAMES.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="V kolik" htmlFor="rule-time" hint="prázdné = celý den">
              <Input
                id="rule-time"
                type="time"
                value={draft.time ?? ""}
                onChange={(e) =>
                  set({ time: isValidRuleTime(e.target.value) ? e.target.value : null })
                }
              />
            </Field>
          </div>
        )}

        {/* Náhled je tu proto, že „nejbližší sobota" se nedá spolehlivě
            představit - hlavně v sobotu. */}
        <div className={cn("rounded-lg border bg-muted/30 px-3 py-2 text-sm")}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Teď by vyšlo na</p>
          <p className="tabular mt-0.5 font-medium">{formatDue(at.date, at.time, now)}</p>
        </div>
      </div>
    </Dialog>
  );
}
