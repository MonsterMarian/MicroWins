"use client";

import * as React from "react";
import { Download, Sparkles, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import { plural } from "@/lib/utils";

export function DataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, exportJson, importJson, loadDemo, reset } = useStore();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ok = importJson(await file.text());
    toast(
      ok
        ? { tone: "info", title: "Data načtena", description: file.name }
        : { tone: "warn", title: "Soubor nejde načíst", description: "Nevypadá jako export MicroWins." },
    );
    if (ok) onOpenChange(false);
  };

  const metrics = state.nodes.filter((n) => n.kind === "metric").length;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Data"
      description="Vše se ukládá lokálně v prohlížeči. Záloha je na tobě."
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center">
          {[
            {
              label: plural(state.projects.length, "projekt", "projekty", "projektů"),
              value: state.projects.length,
            },
            {
              label: plural(state.tasks.length, "úkol", "úkoly", "úkolů"),
              value: state.tasks.length,
            },
            { label: plural(metrics, "metrika", "metriky", "metrik"), value: metrics },
            {
              label: plural(state.entries.length, "záznam", "záznamy", "záznamů"),
              value: state.entries.length,
            },
            {
              label: plural(state.microwins.length, "microwin", "microwiny", "microwinů"),
              value: state.microwins.length,
            },
            {
              label: plural(state.snapshots.length, "otisk", "otisky", "otisků"),
              value: state.snapshots.length,
            },
          ].map((s) => (
            <div key={s.label}>
              <dd className="tabular text-lg font-semibold">{s.value}</dd>
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={exportJson} className="justify-start">
            <Download /> Exportovat JSON
          </Button>
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            className="justify-start"
          >
            <Upload /> Importovat JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onFile}
          />
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => {
              loadDemo();
              toast({ tone: "info", title: "Ukázková data načtena" });
              onOpenChange(false);
            }}
          >
            <Sparkles /> Načíst ukázková data
          </Button>
          <Button
            variant={confirmReset ? "destructive" : "ghost"}
            className="justify-start"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              reset();
              setConfirmReset(false);
              toast({ tone: "warn", title: "Data smazána" });
              onOpenChange(false);
            }}
          >
            <Trash2 /> {confirmReset ? "Opravdu smazat všechno?" : "Smazat všechna data"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
