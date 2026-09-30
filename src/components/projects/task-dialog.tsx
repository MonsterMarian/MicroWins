"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconField } from "@/components/ui/icon-picker";
import { Field, Input, Select } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { hasOwnProgress } from "@/lib/project-actions";
import { milestonesOfProject, taskById } from "@/lib/projects";
import type { Task } from "@/lib/types";
import { cn, formatNumber, parseWhole } from "@/lib/utils";

const QUICK_ICONS = ["lucide:CheckCircle2", "lucide:Target", "lucide:Zap", "💪", "🏃", "🧠", "🎯"];

export function TaskDialog({
  open,
  onOpenChange,
  projectId,
  task,
  parentId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Vyplněno = editace. */
  task?: Task;
  /** Vyplněno = zakládáme podúkol. */
  parentId?: string | null;
}) {
  const { state, createTask, updateTask } = useStore();
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState("lucide:CheckCircle2");
  const [target, setTarget] = React.useState("1");
  const [current, setCurrent] = React.useState("0");
  const [unit, setUnit] = React.useState("");
  const [step, setStep] = React.useState("1");
  const [weight, setWeight] = React.useState("1");
  const [dueDate, setDueDate] = React.useState("");
  const [milestoneId, setMilestoneId] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  /** Nechat rodiči i jeho čísla (`progressFrom: "both"`) - výchozí je nechat, ztratit je horší. */
  const [keepProgress, setKeepProgress] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    setName(task?.name ?? "");
    setIcon(task?.icon ?? "lucide:CheckCircle2");
    setTarget(String(task?.target ?? 1));
    setCurrent(String(task?.current ?? 0));
    setUnit(task?.unit ?? "");
    setStep(String(task?.step ?? 1));
    setWeight(String(task?.weight ?? 1));
    setDueDate(task?.dueDate ?? "");
    setMilestoneId(task?.milestoneId ?? "");
    setDescription(task?.description ?? "");
    setError(null);
    setKeepProgress(true);
  }, [open, task]);

  const milestones = milestonesOfProject(state, projectId);
  /* První podúkol pod úkolem s vlastním postupem by ten postup přebil -
     úkol s podúkoly se jinak počítá jen z nich. Nabídne se nechat obojí. */
  const parent = !task && parentId ? taskById(state, parentId) : undefined;
  const atRisk = parent ? hasOwnProgress(state, parent) : false;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Název úkolu nesmí být prázdný.");
      return;
    }
    // Úkoly jedou v celých číslech, viz `whole()` v project-actions.
    const targetNum = parseWhole(target);
    if (!Number.isFinite(targetNum) || targetNum <= 0) {
      setError("Cíl musí být celé číslo větší než 0.");
      return;
    }
    const currentNum = Number.isFinite(parseWhole(current)) ? parseWhole(current) : 0;
    const stepNum = Number.isFinite(parseWhole(step)) && parseWhole(step) > 0 ? parseWhole(step) : 1;
    const weightNum =
      Number.isFinite(parseWhole(weight)) && parseWhole(weight) > 0 ? parseWhole(weight) : 1;

    if (task) {
      updateTask(task.id, {
        name: trimmed,
        icon,
        target: targetNum,
        current: currentNum,
        unit: unit.trim() || undefined,
        step: stepNum,
        weight: weightNum,
        dueDate: dueDate || null,
        milestoneId: milestoneId || null,
        description,
      });
    } else {
      if (parent && atRisk && keepProgress) updateTask(parent.id, { progressFrom: "both" });
      createTask(projectId, {
        name: trimmed,
        icon,
        target: targetNum,
        current: currentNum,
        unit: unit.trim() || undefined,
        step: stepNum,
        weight: weightNum,
        dueDate: dueDate || null,
        milestoneId: milestoneId || null,
        description,
        parentId,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Upravit úkol" : parentId ? "Nový podúkol" : "Nový úkol"}
      description="Úkol je číselný cíl - postup se počítá jako hodnota ku cíli."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={submit}>{task ? "Uložit" : "Vytvořit"}</Button>
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
        <Field label="Název" htmlFor="task-name">
          <Input
            id="task-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="2000 kliků"
            autoComplete="off"
          />
        </Field>

        <Field label="Ikona">
          <IconField value={icon} onChange={setIcon} quick={QUICK_ICONS} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Cíl" htmlFor="task-target" hint="1 = odškrtnout">
            <Input
              id="task-target"
              value={target}
              inputMode="numeric"
              onChange={(e) => {
                setTarget(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <Field label="Hotovo" htmlFor="task-current">
            <Input
              id="task-current"
              value={current}
              inputMode="numeric"
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="Jednotka" htmlFor="task-unit">
            <Input
              id="task-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ks"
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="O kolik skočí + a −" htmlFor="task-step" hint="1 = po jednom">
            <Input
              id="task-step"
              value={step}
              inputMode="numeric"
              onChange={(e) => setStep(e.target.value)}
            />
          </Field>
          <Field label="Váha v projektu" htmlFor="task-weight" hint="1 = běžný úkol">
            <Input
              id="task-weight"
              value={weight}
              inputMode="numeric"
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Termín (nepovinné)" htmlFor="task-due">
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label="Milník" htmlFor="task-milestone">
            <Select
              id="task-milestone"
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
            >
              <option value="">Bez milníku</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Popis (nepovinné)" htmlFor="task-desc">
          <Input
            id="task-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoComplete="off"
          />
        </Field>

        {parent && atRisk ? (
          <button
            type="button"
            onClick={() => setKeepProgress((v) => !v)}
            aria-pressed={keepProgress}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
              keepProgress ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                Nechat i čísla {formatNumber(parent.current)} / {formatNumber(parent.target)}
                {parent.unit ? ` ${parent.unit}` : ""}
              </span>
              <span className="block text-xs text-muted-foreground">
                {keepProgress
                  ? "Úkol bude mít dva pruhy - čísla a podúkoly - a procenta budou jejich průměr."
                  : "Procenta se začnou počítat jen z podúkolů. Čísla zůstanou schovaná, přepnout to jde v Nastavení úkolu."}
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                keepProgress ? "bg-progress" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 size-4 rounded-full bg-card shadow transition-[left] duration-200",
                  keepProgress ? "left-6" : "left-1",
                )}
              />
            </span>
          </button>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Dialog>
  );
}
