"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconField } from "@/components/ui/icon-picker";
import { Field, Input, Select } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { milestonesOfProject } from "@/lib/projects";
import type { Task } from "@/lib/types";
import { parseWhole } from "@/lib/utils";

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
  }, [open, task]);

  const milestones = milestonesOfProject(state, projectId);

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

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Dialog>
  );
}
