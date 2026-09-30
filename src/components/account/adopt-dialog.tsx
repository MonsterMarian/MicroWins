"use client";

import * as React from "react";
import { Download, LogOut, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAccount } from "@/components/providers/use-account";
import { useSyncStatus } from "@/components/providers/use-sync";
import { useToast } from "@/components/providers/toast-provider";
import { useExport } from "@/components/settings/backup-dialogs";
import { signOut } from "@/lib/account";
import { countState, type StateCounts } from "@/lib/import";
import { isNative } from "@/lib/native";
import { confirmAdoption, postponeAdoption } from "@/lib/sync-runtime";
import type { MicroWinsState } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

/**
 * Převzetí dat do účtu - okno, které vyskočí po přihlášení, když jsou
 * v zařízení data, která v účtu ještě nejsou (DATABAZE.md, kap. 5).
 *
 * Bydlí mimo Nastavení, protože přihlášení nemusí začít tam: appka se po
 * aktualizaci může otevřít s přihlášením z dřívějška a ptát se hned.
 */
export function SyncDialogs() {
  const sync = useSyncStatus();
  const plan = sync.plan;
  // Chyba při převzetí nechá okno otevřené i s hláškou (`sync.message`).
  if (!plan || !sync.asking || plan.kind === "fresh") return null;
  return plan.kind === "merge" ? (
    <MergeDialog
      account={plan.account}
      merged={plan.merged.state}
      local={plan.local}
      conflicts={plan.merged.conflicts.length}
      message={sync.message}
    />
  ) : (
    <ForeignDialog account={plan.account} local={plan.local} message={sync.message} />
  );
}

function MergeDialog({
  account,
  local,
  merged,
  conflicts,
  message,
}: {
  account: MicroWinsState;
  local: MicroWinsState;
  merged: MicroWinsState;
  conflicts: number;
  message?: string;
}) {
  const me = useAccount();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const before = countState(account);
  const after = countState(merged);
  const empty = summary(before) === "";

  const [dropLocal, setDropLocal] = React.useState(false);

  const confirm = async (mode: "merge" | "account") => {
    setBusy(true);
    const ok = await confirmAdoption(mode);
    setBusy(false);
    if (!ok) return;
    toast(
      mode === "merge"
        ? { tone: "info", title: "Data jsou v účtu", description: "Změny se odteď synchronizují." }
        : { tone: "info", title: "Převzatá data z účtu", description: "Předchozí data zařízení jsou v záloze." },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && postponeAdoption()}
      title="Spojit data s účtem"
      description={me.status === "signed-in" ? me.email : undefined}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={postponeAdoption}>
            Teď ne
          </Button>
          {dropLocal ? (
            <Button variant="destructive" disabled={busy} onClick={() => confirm("account")}>
              {busy ? "Přebírám…" : "Zahodit a vzít účet"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => confirm("merge")}>
              <Merge /> {busy ? "Spojuju…" : "Spojit"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {dropLocal
            ? "Do zařízení se nahraje obsah účtu. Data, která tu jsou teď, do účtu nepůjdou."
            : empty
              ? "Účet je zatím prázdný - nahraje se do něj všechno z tohohle zařízení."
              : "Co je jen tady, přibude do účtu. Co už v účtu je, zůstane jednou. Nic se nesmaže."}
        </p>

        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <Row label="V tomhle zařízení" value={summary(countState(local)) || "nic"} />
          <Row label="V účtu" value={summary(before) || "nic"} />
        </div>

        {/* Při převzetí jen účtu se nic nespojuje - náhled spojení by lhal. */}
        <div className={cn("flex flex-col gap-1.5 rounded-lg border p-3", dropLocal && "hidden")}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Po spojení v účtu
          </p>
          {COUNTS.map(([key, label]) =>
            after[key] > 0 || before[key] > 0 ? (
              <div key={key} className="flex items-baseline gap-2 text-sm">
                <span className="flex-1">{label}</span>
                <span className="tabular shrink-0">
                  {after[key] !== before[key] ? (
                    <>
                      <span className="text-muted-foreground">{before[key]}</span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="font-medium">{after[key]}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{after[key]}</span>
                  )}
                </span>
              </div>
            ) : null,
          )}
        </div>

        {conflicts > 0 && !dropLocal ? (
          <p className="text-xs text-muted-foreground">
            {conflicts} {plural(conflicts, "věc je", "věci jsou", "věcí je")} v zařízení i v účtu, ale
            jinak - zůstane verze z účtu.
          </p>
        ) : null}

        <BackupNote />

        {/* Zkušební data (vývoj, půjčený telefon) do účtu nepatří - a spojit
            je by znamenalo, že je dostane i každé další zařízení. */}
        <button
          type="button"
          onClick={() => setDropLocal((v) => !v)}
          aria-pressed={dropLocal}
          className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {dropLocal
            ? "Ne, data z tohohle zařízení chci spojit"
            : "Data v tomhle zařízení nechci - vzít jen data z účtu"}
        </button>
        {dropLocal ? (
          <p className="text-xs text-destructive">
            Data z tohohle zařízení se nahradí tím, co je v účtu. Do účtu z nich nepůjde nic.
          </p>
        ) : null}

        {message ? <p className="text-xs text-destructive">{message}</p> : null}
      </div>
    </Dialog>
  );
}

function ForeignDialog({
  account,
  local,
  message,
}: {
  account: MicroWinsState;
  local: MicroWinsState;
  message?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const replace = async () => {
    setBusy(true);
    const ok = await confirmAdoption("account");
    setBusy(false);
    if (ok) toast({ tone: "info", title: "Data účtu jsou v zařízení" });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && postponeAdoption()}
      title="V zařízení jsou data jiného účtu"
      description="Patří účtu, který tu byl přihlášený dřív. Do tohoto účtu se samy nepřidají."
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              await signOut();
              toast({ tone: "info", title: "Odhlášeno", description: "Data v zařízení zůstala." });
            }}
          >
            <LogOut /> Odhlásit
          </Button>
          <Button variant="destructive" disabled={busy} onClick={replace}>
            {busy ? "Nahrazuju…" : "Nahradit daty účtu"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <Row label="V tomhle zařízení" value={summary(countState(local)) || "nic"} />
          <Row label="V účtu" value={summary(countState(account)) || "nic"} />
        </div>
        <p className="text-sm text-muted-foreground">
          Nahrazením se data v zařízení přepíšou tím, co je v účtu. Pokud je chceš mít u sebe,
          ulož si je napřed do souboru.
        </p>
        <BackupNote />
        {message ? <p className="text-xs text-destructive">{message}</p> : null}
      </div>
    </Dialog>
  );
}

/** Záloha před spojením se odkládá sama; do souboru si ji člověk může vzít. */
function BackupNote() {
  const { busy, run } = useExport();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Než se cokoli změní, odloží se záloha dat z tohohle zařízení.
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2"
        disabled={busy !== null}
        onClick={() => run(isNative() ? "save" : "share")}
      >
        <Download className="size-3.5" /> Do souboru
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-right">{value}</span>
    </div>
  );
}

const COUNTS: [keyof StateCounts, string][] = [
  ["projects", "Projekty"],
  ["tasks", "Úkoly a atomy"],
  ["todos", "ToDo"],
  ["blocks", "Plán dne"],
  ["sheets", "Time box (dny)"],
  ["folders", "Složky"],
  ["wins", "Winy"],
  ["microwins", "Microwiny"],
];

/** "3 projekty, 12 úkolů, 2 složky" - bez nul; prázdný stav = "". */
function summary(c: StateCounts): string {
  const parts: string[] = [];
  if (c.projects) parts.push(`${c.projects} ${plural(c.projects, "projekt", "projekty", "projektů")}`);
  if (c.tasks) parts.push(`${c.tasks} ${plural(c.tasks, "úkol", "úkoly", "úkolů")}`);
  if (c.todos) parts.push(`${c.todos} ToDo`);
  if (c.folders) parts.push(`${c.folders} ${plural(c.folders, "složka", "složky", "složek")}`);
  if (c.wins) parts.push(`${c.wins} ${plural(c.wins, "win", "winy", "winů")}`);
  if (c.sheets) parts.push(`${c.sheets} ${plural(c.sheets, "den", "dny", "dnů")} v time boxu`);
  return parts.join(", ");
}
