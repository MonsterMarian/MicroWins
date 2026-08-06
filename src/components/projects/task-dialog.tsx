"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { milestonesOfProject } from "@/lib/projects";
import type { Task } from "@/lib/types";
import { parseNumber } from "@/lib/utils";

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
    const targetNum = parseNumber(target);
    if (!Number.isFinite(targetNum) || targetNum <= 0) {
      setError("Cíl musí být číslo větší než 0.");
      return;
    }
    const currentNum = Number.isFinite(parseNumber(current)) ? parseNumber(current) : 0;
    const stepNum = Number.isFinite(parseNumber(step)) && parseNumber(step) > 0 ? parseNumber(step) : 1;
    const weightNum =
      Number.isFinite(parseNumber(weight)) && parseNumber(weight) > 0 ? parseNumber(weight) : 1;

    if (task) {
      updateTask(task.id, {
        name: trimmed,
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

        <div className="grid grid-cols-3 gap-3">
          <Field label="Cíl" htmlFor="task-target">
            <Input
              id="task-target"
              value={target}
              inputMode="decimal"
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
              inputMode="decimal"
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
          <Field label="Krok tlačítek +/-" htmlFor="task-step">
            <Input
              id="task-step"
              value={step}
              inputMode="decimal"
              onChange={(e) => setStep(e.target.value)}
            />
          </Field>
          <Field label="Váha v projektu" htmlFor="task-weight" hint="1 = běžný úkol">
            <Input
              id="task-weight"
              value={weight}
              inputMode="decimal"
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
