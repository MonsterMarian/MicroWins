"use client";

import * as React from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { displayPercent, subtasksOf, taskPercent, trackerOf } from "@/lib/projects";
import type { Task, TaskTracker } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * Úprava buňky mapy atomů: nadpis, co je v nadpisu a popis.
 *
 * Na plátně se buňka jen čte, odškrtává a tahá - psát do buňky zmenšené na
 * 40 % by bylo trápení, a popis na víc řádků se tam stejně nevejde celý.
 */

const TRACKERS: { id: TaskTracker; label: string; hint: string }[] = [
  { id: "check", label: "Zaškrtávátko", hint: "hotovo = 100 %, nehotovo = 0 %" },
  { id: "count", label: "Počítadlo", hint: "x/y - třeba 3/6 je 50 %" },
  { id: "none", label: "Nic", hint: "jen poznámka, do procent se nepočítá" },
];

/** Výchozí cíl počítadla, když se na něj přepne ze zaškrtávátka. */
const DEFAULT_COUNT = 5;

export function AtomEditor({
  task,
  onClose,
  onDelete,
}: {
  task: Task | null;
  onClose: () => void;
  onDelete: (task: Task) => void;
}) {
  if (!task) return null;
  // Klíč podle buňky: formulář se naplní znovu jen při otevření jiné buňky.
  return <EditorForm key={task.id} task={task} onClose={onClose} onDelete={onDelete} />;
}

function EditorForm({
  task,
  onClose,
  onDelete,
}: {
  task: Task;
  onClose: () => void;
  onDelete: (task: Task) => void;
}) {
  const { state, updateTask } = useStore();
  const kind = trackerOf(state, task);
  const [name, setName] = React.useState(task.name);
  const [description, setDescription] = React.useState(task.description);
  const [tracker, setTracker] = React.useState<TaskTracker>(kind === "parent" ? "check" : kind);
  const [done, setDone] = React.useState(task.current >= task.target);
  const [current, setCurrent] = React.useState(task.current);
  const [target, setTarget] = React.useState(task.target > 1 ? task.target : DEFAULT_COUNT);

  const children = subtasksOf(state, task.id);
  const parent = children.length > 0;

  const ready = name.trim() !== "";
  const countTarget = Math.max(1, Math.round(target) || 1);
  const countCurrent = Math.min(countTarget, Math.max(0, Math.round(current) || 0));

  const save = () => {
    if (!ready) return;
    const patch: Partial<Task> = { name: name.trim(), description: description.trim() };
    if (!parent) {
      patch.tracker = tracker;
      if (tracker === "check") {
        patch.target = 1;
        patch.current = done ? 1 : 0;
      } else if (tracker === "count") {
        patch.target = countTarget;
        patch.current = countCurrent;
      }
      // Poznámka nemá táhnout procenta dolů; zpátky z poznámky se zase počítá.
      if (tracker === "none") patch.weight = 0;
      else if (kind === "none" && task.weight === 0) patch.weight = 1;
    }
    updateTask(task.id, patch);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Upravit kus"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-destructive hover:text-destructive"
            onClick={() => {
              onClose();
              onDelete(task);
            }}
          >
            <Trash2 /> Smazat
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button disabled={!ready} onClick={save}>
            Uložit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nadpis" htmlFor="atom-title">
          <Input
            id="atom-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">V nadpisu</span>
          {parent ? (
            <p className="text-xs text-muted-foreground">
              Procenta se počítají z {children.length}{" "}
              {plural(children.length, "kusu", "kusů", "kusů")} pod ním - teď{" "}
              {displayPercent(taskPercent(state, task))} %.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup">
                {TRACKERS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={tracker === t.id}
                    onClick={() => setTracker(t.id)}
                    className={cn(
                      "rounded-md py-1.5 text-xs transition-colors",
                      tracker === t.id
                        ? "bg-background font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {TRACKERS.find((t) => t.id === tracker)?.hint}
              </p>

              {tracker === "check" ? (
                <button
                  type="button"
                  onClick={() => setDone((v) => !v)}
                  aria-pressed={done}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                    done ? "border-progress/60 bg-progress/10" : "hover:bg-accent/50",
                  )}
                >
                  {done ? "Hotovo" : "Ještě ne"}
                  <span className="tabular text-xs text-muted-foreground">{done ? 100 : 0} %</span>
                </button>
              ) : tracker === "count" ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Ubrat"
                    onClick={() => setCurrent(Math.max(0, countCurrent - task.step))}
                  >
                    <Minus />
                  </Button>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={String(current)}
                    onChange={(e) => setCurrent(Number(e.target.value))}
                    aria-label="Hotovo"
                    className="h-8 w-16 text-center"
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Přidat"
                    onClick={() => setCurrent(Math.min(countTarget, countCurrent + task.step))}
                  >
                    <Plus />
                  </Button>
                  <span className="text-sm text-muted-foreground">z</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={String(target)}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    aria-label="Celkem"
                    className="h-8 w-16 text-center"
                  />
                  <span className="tabular ml-auto text-xs text-muted-foreground">
                    {displayPercent((countCurrent / countTarget) * 100)} %
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>

        <Field label="Popis" htmlFor="atom-description">
          <Textarea
            id="atom-description"
            value={description}
            rows={4}
            placeholder="Cokoliv - postup, odkaz, na koho se čeká…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
