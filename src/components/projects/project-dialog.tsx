"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconField } from "@/components/ui/icon-picker";
import { Field, Input } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { DEFAULT_PROJECT_ICON } from "@/lib/icons";
import type { Project } from "@/lib/types";

/** Rychlá volba vedle tlačítka - zbytek katalogu je v okně s výběrem. */
const QUICK_ICONS = [DEFAULT_PROJECT_ICON, "💪", "📖", "💰", "🎯", "🧠", "🏃"];

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vyplněno = editace. */
  project?: Project;
  onCreated?: (id: string) => void;
}) {
  const { today, createProject, updateProject } = useStore();
  const [name, setName] = React.useState("");
  const [icon, setIcon] = React.useState(DEFAULT_PROJECT_ICON);
  const [startDate, setStartDate] = React.useState(today);
  const [deadline, setDeadline] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setIcon(project?.icon ?? DEFAULT_PROJECT_ICON);
    setStartDate(project?.startDate ?? today);
    setDeadline(project?.deadline ?? "");
    setDescription(project?.description ?? "");
    setError(null);
  }, [open, project, today]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Název projektu nesmí být prázdný.");
      return;
    }
    if (deadline && deadline < startDate) {
      setError("Deadline nemůže být dřív než start.");
      return;
    }
    if (project) {
      updateProject(project.id, {
        name: trimmed,
        icon,
        startDate,
        deadline: deadline || null,
        description,
      });
    } else {
      const created = createProject({
        name: trimmed,
        icon,
        startDate,
        deadline: deadline || null,
        description,
      });
      onCreated?.(created.id);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={project ? "Upravit projekt" : "Nový projekt"}
      description={project ? undefined : "Cíl, který se dá rozdělit na měřitelné úkoly."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={submit}>{project ? "Uložit" : "Vytvořit"}</Button>
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
        <Field label="Název projektu" htmlFor="project-name">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="10K kliků"
            autoComplete="off"
          />
        </Field>

        <Field label="Ikona">
          <IconField value={icon} onChange={setIcon} quick={QUICK_ICONS} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" htmlFor="project-start">
            <Input
              id="project-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value || today)}
            />
          </Field>
          <Field
            label="Deadline"
            htmlFor="project-deadline"
            hint={deadline ? undefined : "Prázdné = bez deadlinu"}
          >
            <div className="flex gap-1">
              <Input
                id="project-deadline"
                type="date"
                value={deadline}
                min={startDate}
                onChange={(e) => {
                  setDeadline(e.target.value);
                  setError(null);
                }}
              />
              {deadline ? (
                <Button variant="ghost" size="icon" aria-label="Zrušit deadline" onClick={() => setDeadline("")}>
                  ×
                </Button>
              ) : null}
            </div>
          </Field>
        </div>

        <Field label="Popis (nepovinné)" htmlFor="project-desc">
          <Input
            id="project-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="K čemu to je"
            autoComplete="off"
          />
        </Field>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Dialog>
  );
}
