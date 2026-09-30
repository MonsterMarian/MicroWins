"use client";

import * as React from "react";
import { Check, Download, Save, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import {
  hasSettings,
  parseBackup,
  type BackupOptions,
  type ExportTarget,
  type ParsedBackup,
} from "@/lib/backup";
import { countState, mergeState, type ImportMode } from "@/lib/import";
import { isNative } from "@/lib/native";
import {
  ALL_PARTS,
  DATA_PARTS,
  describePart,
  isAllParts,
  isDataPart,
  partInfo,
  partsIn,
  type DataPart,
} from "@/lib/parts";
import type { MicroWinsState } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Ukládání a načítání dat - celé zálohy i jednotlivých částí.
 *
 * Bydlí mimo `settings-dialog.tsx`, protože se k němu chodí ze tří míst:
 * ze Zálohy v Nastavení (všechno nebo výběr), od addonů v Nastavení (každý
 * svou část) a z atomizéru (jedna mapa). Dialogy jsou pro všechny stejné,
 * liší se jen tím, co je předvybrané a co se smí měnit.
 */

// --- export -----------------------------------------------------------------

/**
 * Spustí export a řekne hláškou, kde soubor hledat. Dvě tlačítka naráz jet
 * nesmí - `busy` drží, který export zrovna běží.
 */
export function useExport() {
  const { exportJson } = useStore();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<ExportTarget | null>(null);

  const run = async (
    target: ExportTarget,
    options?: BackupOptions & { source?: MicroWinsState },
  ): Promise<boolean> => {
    setBusy(target);
    const res = await exportJson(target, options);
    setBusy(null);

    if (res.kind === "failed") {
      toast({ tone: "warn", title: "Export se nepovedl", description: res.message.slice(0, 120) });
      return false;
    }
    // Zavřené sdílení není chyba ani úspěch - uživatel ví, že nic nechtěl.
    if (res.kind === "cancelled") return false;

    toast({
      tone: "info",
      title: options?.parts && !isAllParts(options.parts) ? "Uloženo do souboru" : "Záloha vytvořena",
      description:
        res.kind === "shared"
          ? "Vyber, kam ji uložit nebo komu poslat."
          : res.kind === "saved"
            ? `Dokumenty / ${res.name}`
            : "Soubor je ve složce Stažené.",
    });
    return true;
  };

  return { busy, run };
}

/**
 * Doručení souboru. V appce má smysl vybrat si, kam soubor půjde; prohlížeč
 * umí jen stáhnout, a jedno tlačítko tam říká pravdu líp než dvě.
 */
export function DeliveryButtons({
  disabled,
  busy,
  onExport,
}: {
  disabled?: boolean;
  busy: ExportTarget | null;
  onExport: (target: ExportTarget) => void;
}) {
  const [native, setNative] = React.useState(false);
  React.useEffect(() => setNative(isNative()), []);

  if (!native) {
    return (
      <Button disabled={disabled || busy !== null} onClick={() => onExport("share")}>
        <Download /> {busy ? "Připravuju…" : "Stáhnout"}
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || busy !== null}
        onClick={() => onExport("save")}
      >
        <Save /> {busy === "save" ? "Ukládám…" : "Do telefonu"}
      </Button>
      <Button disabled={disabled || busy !== null} onClick={() => onExport("share")}>
        <Share2 /> {busy === "share" ? "Připravuju…" : "Poslat"}
      </Button>
    </>
  );
}

/** Kousek do jména souboru: `microwins-todo-plan-2026-09-30.json`. */
function partsLabel(parts: readonly DataPart[]): string | undefined {
  return isAllParts(parts) ? undefined : parts.join("-");
}

/**
 * Uložení vybraných částí do souboru.
 *
 * `initial` předvybere, co se má uložit (addon v Nastavení předvybere sebe).
 * Nastavení appky se přibalí samo jen k úplné záloze; u části by po načtení
 * překvapilo, ale dá se přidat ručně.
 */
export function ExportDialog({
  open,
  onOpenChange,
  initial = ALL_PARTS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: readonly DataPart[];
}) {
  const { state } = useStore();
  const { busy, run } = useExport();
  const [parts, setParts] = React.useState<DataPart[]>([...initial]);
  const [settingsChoice, setSettingsChoice] = React.useState<boolean | null>(null);

  // Každé otevření začíná od předvolby - jinak by si dialog pamatoval výběr
  // z jiného addonu. Klíčem je obsah, ne pole: volající ho skládá při renderu.
  const initialKey = initial.join(",");
  React.useEffect(() => {
    if (!open) return;
    setParts(initialKey.split(",").filter(isDataPart));
    setSettingsChoice(null);
  }, [open, initialKey]);

  const withSettings = settingsChoice ?? isAllParts(parts);
  const empty = new Set(ALL_PARTS.filter((p) => !partsIn(state).includes(p)));
  const chosen = parts.filter((p) => !empty.has(p));

  const onExport = async (target: ExportTarget) => {
    const ok = await run(target, {
      parts: chosen,
      settings: withSettings,
      label: partsLabel(chosen),
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Uložit do souboru"
      description="Vyber, co má soubor nést. Načíst se dá zpátky tady, nebo na jiném zařízení."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <DeliveryButtons disabled={chosen.length === 0} busy={busy} onExport={onExport} />
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {DATA_PARTS.map((p) => (
          <ToggleRow
            key={p.id}
            label={p.label}
            hint={empty.has(p.id) ? "nic tu není" : describePart(state, p.id)}
            on={chosen.includes(p.id)}
            disabled={empty.has(p.id)}
            onToggle={() =>
              setParts((prev) =>
                prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
              )
            }
          />
        ))}
        <ToggleRow
          label="Nastavení"
          hint="vzhled, addony, pořadí záložek, rychlé termíny"
          on={withSettings}
          onToggle={() => setSettingsChoice(!withSettings)}
        />
        <p className="px-1 pt-1 text-xs text-muted-foreground">
          Klíč k AI se neukládá nikdy - zůstává jen v tomhle zařízení.
        </p>
      </div>
    </Dialog>
  );
}

// --- import -----------------------------------------------------------------

export interface PendingImport {
  text: string;
  /** Odkud data přišla - jméno souboru nebo "vložený text". */
  source: string;
  parsed: ParsedBackup;
  /** Části, které se z něj smějí vzít (addon načítá jen tu svou). */
  only: DataPart[] | null;
}

/** Části, které se ze souboru dají opravdu načíst. */
export function availableParts(pending: Pick<PendingImport, "parsed" | "only">): DataPart[] {
  const declared = pending.parsed.parts ?? ALL_PARTS;
  return partsIn(pending.parsed.state).filter(
    (p) => declared.includes(p) && (pending.only ?? ALL_PARTS).includes(p),
  );
}

/**
 * Skrytý výběr souboru. Soubor se rovnou rozebere; když nejde přečíst nebo
 * v něm není nic z toho, co se má načíst, řekne to hláška a dialog se ani
 * neotevře.
 */
export function useBackupPicker(onPending: (pending: PendingImport) => void) {
  const { toast } = useToast();
  const ref = React.useRef<HTMLInputElement>(null);
  const only = React.useRef<DataPart[] | null>(null);

  const offer = (text: string, source: string) => {
    const parsed = parseBackup(text);
    if (!parsed) {
      toast({ tone: "warn", title: "Soubor nejde načíst", description: "Nevypadá jako záloha MicroWins." });
      return;
    }
    const pending: PendingImport = { text, source, parsed, only: only.current };
    if (availableParts(pending).length === 0) {
      toast({
        tone: "warn",
        title: "Není co načíst",
        description: only.current
          ? `V souboru není nic z: ${only.current.map((p) => partInfo(p).label).join(", ")}.`
          : "Záloha je prázdná.",
      });
      return;
    }
    onPending(pending);
  };

  const input = (
    <input
      ref={ref}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) offer(await file.text(), file.name);
      }}
    />
  );

  return {
    input,
    /** Otevře výběr souboru; `parts` omezí, co se z něj smí vzít. */
    open: (parts?: DataPart[]) => {
      only.current = parts ?? null;
      ref.current?.click();
    },
  };
}

const MODES: { id: ImportMode; label: string; hint: string }[] = [
  { id: "add", label: "Přidat", hint: "nic se nesmaže, data se připojí" },
  { id: "replace", label: "Nahradit", hint: "vybrané části se přepíšou souborem" },
];

/**
 * Náhled importu: co je v souboru, co se s tím stane a co zůstane.
 * Počty "po načtení" se počítají skutečným sloučením, ne odhadem - co je
 * v náhledu, to se opravdu uloží.
 */
export function ImportDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: PendingImport;
  onClose: () => void;
  onDone: () => void;
}) {
  const { state, importJson } = useStore();
  const { toast } = useToast();
  const available = React.useMemo(() => availableParts(pending), [pending]);
  const [parts, setParts] = React.useState<DataPart[]>(available);
  const [mode, setMode] = React.useState<ImportMode>("add");
  const [settingsChoice, setSettingsChoice] = React.useState<boolean | null>(null);

  const incoming = pending.parsed.state;
  /* Nastavení se nabízí jen u obnovy odsud z Nastavení - addon načítá svoje
     data, ne vzhled appky. Samo se zapne při nahrazení všeho, jako dřív. */
  const offersSettings = pending.only === null && hasSettings(pending.parsed.settings);
  const withSettings =
    offersSettings && (settingsChoice ?? (mode === "replace" && isAllParts(parts)));

  const before = React.useMemo(() => countState(state), [state]);
  const after = React.useMemo(
    () => countState(mergeState(state, incoming, parts, mode)),
    [state, incoming, parts, mode],
  );

  const has = (p: DataPart) => parts.includes(p);
  const labels = parts.map((p) => partInfo(p).label);

  const confirm = () => {
    if (importJson(pending.text, { parts, mode, settings: withSettings })) {
      toast({
        tone: "info",
        title: "Data načtena",
        description: `${pending.source} · ${labels.join(", ").toLowerCase()}`,
      });
      onDone();
    } else {
      toast({ tone: "warn", title: "Načtení selhalo" });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={
        pending.only?.length === 1 ? `Načíst: ${partInfo(pending.only[0]).label}` : "Načíst zálohu"
      }
      description={pending.source}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button
            variant={mode === "replace" ? "destructive" : "default"}
            disabled={parts.length === 0}
            onClick={confirm}
          >
            {mode === "replace" ? "Nahradit" : "Přidat"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Jedna část není co vybírat - stačí říct, co v souboru je. */}
        {available.length === 1 ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              V souboru
            </p>
            <p className="text-sm">
              {partInfo(available[0]).label} · {describePart(incoming, available[0])}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Co načíst</p>
            {available.map((p) => (
              <ToggleRow
                key={p}
                label={partInfo(p).label}
                hint={describePart(incoming, p)}
                on={has(p)}
                onToggle={() =>
                  setParts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
                }
              />
            ))}
            {offersSettings ? (
              <ToggleRow
                label="Nastavení"
                hint="vzhled, addony, pořadí záložek - přepíše to současné"
                on={withSettings}
                onToggle={() => setSettingsChoice(!withSettings)}
              />
            ) : null}
          </div>
        )}

        <Choice label="Jak" options={MODES} value={mode} onChange={setMode} />

        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Po načtení
          </p>
          <Change label="Projekty" from={before.projects} to={after.projects} touched={has("projects")} />
          <Change label="Úkoly a atomy" from={before.tasks} to={after.tasks} touched={has("projects")} />
          <Change label="ToDo" from={before.todos} to={after.todos} touched={has("todo")} />
          <Change
            label="Plán dne"
            from={before.blocks}
            to={after.blocks}
            touched={has("plan") || has("timebox")}
          />
          <Change label="Time box (dny)" from={before.sheets} to={after.sheets} touched={has("timebox")} />
          <Change label="Složky" from={before.folders} to={after.folders} touched={has("tree")} />
          <Change label="Winy" from={before.wins} to={after.wins} touched={has("tree")} />
          <Change label="Microwiny" from={before.microwins} to={after.microwins} touched={has("tree")} />
        </div>

        {mode === "replace" && parts.length > 0 ? (
          <p className="text-xs text-destructive">
            Nahrazení je nevratné.{" "}
            {isAllParts(parts)
              ? "Všechna současná data zmizí."
              : `Zmizí současná data: ${labels.join(", ")}${
                  has("timebox") && !has("plan")
                    ? " a s ním i bloky Plánu dne - mřížka time boxu jsou ony"
                    : ""
                }.`}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// --- drobné kusy ------------------------------------------------------------

/** Řádek se zaškrtávátkem - výběr částí při ukládání i načítání. */
export function ToggleRow({
  label,
  hint,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        on ? "border-foreground/40 bg-accent" : "text-muted-foreground hover:bg-accent/50",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded border",
          on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50",
        )}
      >
        {on ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className={cn("shrink-0", on && "font-medium text-foreground")}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              active
                ? "border-foreground/40 bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            <span className="shrink-0">{o.label}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{o.hint}</span>
            {active ? <Check className="size-3.5 shrink-0 opacity-60" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Řádek "Projekty 2 → 18"; nedotčená část se drží zpátky. */
function Change({
  label,
  from,
  to,
  touched,
}: {
  label: string;
  from: number;
  to: number;
  touched: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className={cn("flex-1", !touched && "text-muted-foreground")}>{label}</span>
      {touched && to !== from ? (
        <span className="tabular shrink-0">
          <span className="text-muted-foreground">{from}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className={cn("font-medium", to < from && "text-destructive")}>{to}</span>
        </span>
      ) : (
        <span className="tabular shrink-0 text-muted-foreground">
          {from} {touched ? "" : "· beze změny"}
        </span>
      )}
    </div>
  );
}
