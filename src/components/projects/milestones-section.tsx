"use client";

import * as React from "react";
import { Check, Flag, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { formatDate } from "@/lib/date";
import { milestonesOfProject } from "@/lib/projects";
import { cn, plural } from "@/lib/utils";

/**
 * Milníky projektu - mezizastávky na ose.
 *
 * Schválně jen zaškrtávátko a datum. Milník **nehýbe procenty** projektu ani
 * úkolů: shrnuje práci, která už je spočítaná v úkolech pod ním, takže by se
 * jednou odvedená práce počítala dvakrát. Je to poznámka „sem jsem došel",
 * ne jednotka postupu.
 */
export function MilestonesSection({ projectId }: { projectId: string }) {
  const { state, createMilestone, toggleMilestoneDone, deleteMilestone } = useStore();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [date, setDate] = React.useState("");

  const milestones = milestonesOfProject(state, projectId);
  const done = milestones.filter((m) => m.doneAt !== null).length;

  const add = () => {
    if (!name.trim()) return;
    createMilestone(projectId, name, date || null);
    setName("");
    setDate("");
    setAdding(false);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Milníky</CardTitle>
          {milestones.length > 0 ? (
            <Badge variant={done === milestones.length ? "solid" : "default"} className="tabular">
              {done} z {milestones.length}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      {milestones.length === 0 ? (
        <CardContent className="pb-5 text-sm text-muted-foreground">
          Zatím žádný milník. Hodí se na mezizastávky, které nejsou měřitelný úkol - „odevzdaná
          přihláška", „půlka roku".
        </CardContent>
      ) : (
        <ul className="divide-y border-t">
          {milestones.map((m) => {
            const checked = m.doneAt !== null;
            const tasks = state.tasks.filter((t) => t.milestoneId === m.id).length;
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
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

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      checked && "text-muted-foreground line-through",
                    )}
                  >
                    {m.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.date ? formatDate(m.date) : "bez data"}
                    {tasks > 0 ? ` · ${tasks} ${plural(tasks, "úkol", "úkoly", "úkolů")}` : ""}
                  </span>
                </span>

                <Flag
                  className={cn("size-4 shrink-0", checked ? "text-progress" : "text-muted-foreground/50")}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Smazat milník ${m.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMilestone(m.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t p-3">
        {adding ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Název milníku"
              aria-label="Název milníku"
              autoComplete="off"
              autoFocus
              className="h-9 min-w-40 flex-1"
            />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Datum milníku"
              className="h-9 w-40"
            />
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Přidat
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Zrušit
            </Button>
          </form>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Přidat milník
          </Button>
        )}
      </div>
    </Card>
  );
}
