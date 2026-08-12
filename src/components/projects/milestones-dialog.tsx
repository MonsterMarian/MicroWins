"use client";

import * as React from "react";
import { Check, Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { milestonesOfProject } from "@/lib/projects";
import { cn, plural } from "@/lib/utils";

/**
 * Správa milníků. Zaškrtnutí, přejmenování, datum, smazání - všechno, co se
 * do řádku v detailu projektu nevejde.
 *
 * Milník **nehýbe procenty**: shrnuje práci, kterou už mají spočítanou úkoly
 * pod ním, takže by se jednou odvedená práce počítala dvakrát.
 */
export function MilestonesDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const { state, createMilestone, updateMilestone, toggleMilestoneDone, deleteMilestone } =
    useStore();
  const [name, setName] = React.useState("");
  const [date, setDate] = React.useState("");

  const milestones = milestonesOfProject(state, projectId);

  React.useEffect(() => {
    if (!open) {
      setName("");
      setDate("");
    }
  }, [open]);

  /* Přidání okno zavírá. Milník je jednorázový zápis, ne seznam, který se
     plní na jeden zátah - zůstat otevřený znamenalo dvě kliknutí navíc
     pokaždé. Kdo jich potřebuje víc, otevře okno znovu. */
  const add = () => {
    if (!name.trim()) return;
    createMilestone(projectId, name, date || null);
    setName("");
    setDate("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Milníky"
      description="Mezizastávky projektu. Do procent se nepočítají - jen se odškrtávají."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zavřít
          </Button>
          <Button form="milestone-form" type="submit" disabled={!name.trim()}>
            <Plus /> Přidat milník
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádný milník.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {milestones.map((m) => {
              const checked = m.doneAt !== null;
              const tasks = state.tasks.filter((t) => t.milestoneId === m.id).length;
              return (
                <li key={m.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`Milník ${m.name}`}
                    onClick={() => toggleMilestoneDone(m.id)}
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-md border-2 transition-colors",
                      checked
                        ? "border-progress bg-progress text-progress-foreground"
                        : "border-border hover:border-progress/60",
                    )}
                  >
                    {checked ? <Check className="size-4" /> : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <Input
                      value={m.name}
                      onChange={(e) => updateMilestone(m.id, { name: e.target.value })}
                      aria-label="Název milníku"
                      className={cn(
                        "h-8 border-0 bg-transparent px-1 text-sm shadow-none",
                        checked && "text-muted-foreground line-through",
                      )}
                    />
                    <p className="px-1 text-xs text-muted-foreground">
                      {m.date ? formatDate(m.date) : "bez data"} · {tasks}{" "}
                      {plural(tasks, "úkol", "úkoly", "úkolů")}
                    </p>
                  </div>

                  <Input
                    type="date"
                    value={m.date ?? ""}
                    onChange={(e) => updateMilestone(m.id, { date: e.target.value || null })}
                    aria-label="Datum milníku"
                    className="h-8 w-36 shrink-0 text-xs"
                  />

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Smazat milník"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMilestone(m.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          id="milestone-form"
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
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flag className="size-3.5" />
            Přidání okno zavře.
          </p>
        </form>
      </div>
    </Dialog>
  );
}
