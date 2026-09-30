"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EntityIcon } from "@/components/ui/icon-picker";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import {
  DeliveryButtons,
  ToggleRow,
  useBackupPicker,
  useExport,
} from "@/components/settings/backup-dialogs";
import type { ExportTarget } from "@/lib/backup";
import { tapFeedback } from "@/lib/native";
import { fileSlug, mapRoots, pickTaskTree } from "@/lib/parts";
import { descendantsOf } from "@/lib/projects";
import type { MicroWinsState, Task } from "@/lib/types";
import { plural } from "@/lib/utils";

/*
 * Uložení a načtení jedné mapy atomů.
 *
 * Atomy vlastní data nemají - mapa je úkol s podúkoly - takže celé se ukládají
 * s projekty. Rozsekání ale bývá práce sama o sobě a dává smysl ho přenést
 * zvlášť: nachystat si rozpad jinde, poslat ho někomu, schovat si šablonu.
 * Soubor jedné mapy je obyčejná záloha s jedním projektem a jedním úkolem,
 * takže jde načíst i obnovou v Nastavení.
 */

export function SaveMapDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state } = useStore();
  const { busy, run } = useExport();
  const pieces = descendantsOf(state, task.id).length;

  const onExport = async (target: ExportTarget) => {
    const slug = fileSlug(task.name);
    const ok = await run(target, {
      source: pickTaskTree(state, task.id),
      parts: ["projects"],
      settings: false,
      label: slug ? `mapa-${slug}` : "mapa",
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Uložit mapu"
      description={
        pieces === 0
          ? `"${task.name}" - zatím nerozsekaný.`
          : `"${task.name}" i s ${pieces} ${plural(pieces, "kusem", "kusy", "kusy")} pod ním.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <DeliveryButtons busy={busy} onExport={onExport} />
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Soubor se dá načíst zpátky tady v Atomech - pod kterýkoli projekt - nebo obnovou
        v Nastavení. Nese i historii postupu, milníky projektu ne.
      </p>
    </Dialog>
  );
}

/**
 * Výběr souboru s mapami. Načíst jde i celá záloha - pak se nabídnou všechny
 * úkoly z ní a vybere se, které se mají přiroubovat.
 */
export function useMapLoader(onLoaded: (taskId: string) => void) {
  const { toast } = useToast();
  const [incoming, setIncoming] = React.useState<{ state: MicroWinsState; source: string } | null>(
    null,
  );
  const picker = useBackupPicker((pending) => {
    if (mapRoots(pending.parsed.state).length === 0) {
      toast({ tone: "warn", title: "V souboru není žádná mapa" });
      return;
    }
    setIncoming({ state: pending.parsed.state, source: pending.source });
  });

  const dialog = incoming ? (
    <LoadMapDialog
      incoming={incoming.state}
      source={incoming.source}
      onClose={() => setIncoming(null)}
      onLoaded={(id) => {
        setIncoming(null);
        onLoaded(id);
      }}
    />
  ) : null;

  return { open: () => picker.open(["projects"]), input: picker.input, dialog };
}

const NEW_PROJECT = "__new__";

function piecesBelow(n: number): string {
  return n === 0 ? "nerozsekaná" : `${n} ${plural(n, "kus", "kusy", "kusů")} pod ním`;
}

function LoadMapDialog({
  incoming,
  source,
  onClose,
  onLoaded,
}: {
  incoming: MicroWinsState;
  source: string;
  onClose: () => void;
  onLoaded: (taskId: string) => void;
}) {
  const { state, createProject, graftTaskTrees } = useStore();
  const { toast } = useToast();
  const roots = React.useMemo(() => mapRoots(incoming), [incoming]);
  const [picked, setPicked] = React.useState<string[]>(() => roots.map((r) => r.id));

  const projects = React.useMemo(
    () =>
      state.projects
        .filter((p) => p.archivedAt === null)
        .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    [state.projects],
  );

  /* Mapa uložená a načtená na stejném telefonu míří rovnou do svého projektu.
     Odjinud se nabídne nový projekt podle toho ze souboru - to je to, co člověk
     posílal; zařadit ji do jiného je jedno ťuknutí. */
  const fileProject = incoming.projects.length === 1 ? incoming.projects[0] : null;
  const [projectId, setProjectId] = React.useState(() =>
    fileProject && projects.some((p) => p.id === fileProject.id) ? fileProject.id : NEW_PROJECT,
  );
  const [projectName, setProjectName] = React.useState(fileProject?.name ?? "Načtené mapy");

  const fresh = projectId === NEW_PROJECT;
  const ready = picked.length > 0 && (!fresh || projectName.trim() !== "");

  const submit = () => {
    if (!ready) return;
    const target = fresh
      ? createProject({
          name: projectName.trim(),
          icon: fileProject?.icon ?? "🧩",
          hidden: fileProject?.hidden === true,
        }).id
      : projectId;
    // Kořeny v pořadí, jak je soubor řadí, ne jak se odklikávaly.
    const ids = graftTaskTrees(
      incoming,
      roots.filter((r) => picked.includes(r.id)).map((r) => r.id),
      target,
    );
    void tapFeedback();
    toast({
      tone: "info",
      title: ids.length === 1 ? "Mapa načtená" : `Načteno ${ids.length} ${plural(ids.length, "mapa", "mapy", "map")}`,
      description: source,
    });
    if (ids[0]) onLoaded(ids[0]);
    else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Načíst mapu"
      description={source}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button disabled={!ready} onClick={submit}>
            <Upload /> Načíst
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {roots.length > 1 ? (
          <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
            {roots.map((root) => {
              const below = descendantsOf(incoming, root.id).length;
              return (
                <ToggleRow
                  key={root.id}
                  label={root.name}
                  hint={`${below} ${plural(below, "kus", "kusy", "kusů")}`}
                  on={picked.includes(root.id)}
                  onToggle={() =>
                    setPicked((prev) =>
                      prev.includes(root.id) ? prev.filter((id) => id !== root.id) : [...prev, root.id],
                    )
                  }
                />
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <EntityIcon icon={roots[0].icon} />
            <span className="min-w-0 flex-1 truncate font-medium">{roots[0].name}</span>
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {piecesBelow(descendantsOf(incoming, roots[0].id).length)}
            </span>
          </div>
        )}

        <Field label="Do projektu" htmlFor="map-project">
          <Select id="map-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.hidden ? " (jen v atomech)" : ""}
              </option>
            ))}
            <option value={NEW_PROJECT}>— nový projekt —</option>
          </Select>
        </Field>

        {fresh ? (
          <Field label="Název projektu" htmlFor="map-project-name">
            <Input
              id="map-project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) submit();
              }}
            />
          </Field>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Mapa se přidá vedle toho, co v projektu je - nic se nepřepíše. Načíst ji dvakrát znamená
          mít ji dvakrát.
        </p>
      </div>
    </Dialog>
  );
}
