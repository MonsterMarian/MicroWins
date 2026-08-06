"use client";

import * as React from "react";
import { Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { milestonePercent } from "@/lib/project-actions";
import { displayPercent, milestonesOfProject } from "@/lib/projects";
import { plural } from "@/lib/utils";

export function MilestonesDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const { state, createMilestone, deleteMilestone } = useStore();
  const [name, setName] = React.useState("");
  const [date, setDate] = React.useState("");

  const milestones = milestonesOfProject(state, projectId);

  const add = () => {
    if (!name.trim()) return;
    createMilestone(projectId, name, date || null);
    setName("");
    setDate("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Milníky"
      description="Mezizastávky projektu. Úkol se dá k milníku přiřadit v jeho detailu."
      footer={
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Zavřít
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádný milník.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {milestones.map((m) => {
              const tasks = state.tasks.filter((t) => t.milestoneId === m.id);
              const percent = milestonePercent(state, m.id);
              return (
                <li key={m.id} className="flex flex-col gap-1.5 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Flag className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      {displayPercent(percent)} %
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Smazat milník"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMilestone(m.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <ProgressBar value={percent} size="sm" />
                  <p className="text-xs text-muted-foreground">
                    {m.date ? formatDate(m.date) : "bez data"} · {tasks.length}{" "}
                    {plural(tasks.length, "úkol", "úkoly", "úkolů")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nový milník" htmlFor="milestone-name">
              <Input
                id="milestone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Polovina"
                autoComplete="off"
              />
            </Field>
            <Field label="Datum (nepovinné)" htmlFor="milestone-date">
              <Input
                id="milestone-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" variant="outline" className="self-start">
            <Plus /> Přidat milník
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
