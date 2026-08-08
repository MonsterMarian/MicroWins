"use client";

import * as React from "react";
import {
  ChevronRight,
  ClipboardPaste,
  Download,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/providers/toast-provider";
import {
  checkForUpdate,
  currentBundleVersion,
  getUpdateUrl,
  pendingBundleVersion,
  revertToBundled,
  setUpdateUrl,
} from "@/lib/live-update";
import { isNative, syncStatusBar } from "@/lib/native";
import { cn, plural } from "@/lib/utils";

/**
 * Nastavení appky. Data (záloha, obnova, smazání) sedí schválně tady,
 * ne v hlavičce - používá se to párkrát za rok.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, exportJson, importJson, loadDemo, reset } = useStore();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [native, setNative] = React.useState(false);

  React.useEffect(() => setNative(isNative()), []);
  React.useEffect(() => {
    if (!open) {
      setConfirmReset(false);
      setPasteOpen(false);
      setPasted("");
    }
  }, [open]);

  const wins = state.nodes.filter((n) => n.kind !== "category").length;
  const folders = state.nodes.filter((n) => n.kind === "category").length;

  const onExport = async () => {
    setBusy(true);
    const res = await exportJson();
    setBusy(false);
    if (res.kind === "failed") {
      toast({ tone: "warn", title: "Export se nepovedl", description: res.message.slice(0, 120) });
      return;
    }
    toast({
      tone: "info",
      title: "Záloha vytvořena",
      description:
        res.kind === "shared"
          ? "Vyber, kam ji uložit nebo komu poslat."
          : res.kind === "saved"
            ? `Uloženo do ${res.path}`
            : "Soubor je ve složce Stažené.",
    });
  };

  const applyText = (text: string, source: string) => {
    if (importJson(text)) {
      toast({ tone: "info", title: "Data načtena", description: source });
      onOpenChange(false);
    } else {
      toast({
        tone: "warn",
        title: "Soubor nejde načíst",
        description: "Nevypadá jako záloha MicroWins.",
      });
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    applyText(await file.text(), file.name);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nastavení"
      description="Vzhled a záloha dat."
    >
      <div className="flex flex-col gap-5">
        <Section title="Vzhled">
          <ThemeChoice />
        </Section>

        <Section
          title="Data"
          hint={
            native
              ? "Vše žije v telefonu. Odinstalace appky data smaže - záloha je na tobě."
              : "Vše žije v prohlížeči. Záloha je na tobě."
          }
        >
          <dl className="mb-1 grid grid-cols-4 gap-2 rounded-lg border bg-muted/30 p-2.5 text-center">
            <Stat value={folders} label={plural(folders, "složka", "složky", "složek")} />
            <Stat value={wins} label={plural(wins, "win", "winy", "winů")} />
            <Stat
              value={state.entries.length}
              label={plural(state.entries.length, "záznam", "záznamy", "záznamů")}
            />
            <Stat
              value={state.projects.length}
              label={plural(state.projects.length, "projekt", "projekty", "projektů")}
            />
          </dl>

          <Button variant="outline" className="justify-start" disabled={busy} onClick={onExport}>
            <Download /> {busy ? "Připravuju zálohu…" : "Exportovat vše"}
          </Button>

          <Button
            variant="outline"
            className="justify-start"
            onClick={() => fileRef.current?.click()}
          >
            <Upload /> Obnovit ze souboru
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onFile}
          />

          {pasteOpen ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder='{"format":"microwins-backup", …}'
                className="min-h-24 font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPasteOpen(false)}>
                  Zrušit
                </Button>
                <Button
                  size="sm"
                  disabled={!pasted.trim()}
                  onClick={() => applyText(pasted, "vložený text")}
                >
                  Načíst
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPasteOpen(true)}
              className="flex items-center gap-1.5 self-start px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ClipboardPaste className="size-3.5" />
              Nebo vlož zálohu jako text
            </button>
          )}
        </Section>

        {native ? <UpdateSection /> : null}

        <Section title="Ostatní">
          <Button
            variant="ghost"
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
          {confirmReset ? (
            <p className="px-1 text-xs text-muted-foreground">
              Nevratné. Nejdřív si udělej zálohu.
            </p>
          ) : null}
        </Section>
      </div>
    </Dialog>
  );
}

/**
 * Živé aktualizace. Bez adresy manifestu se nic neděje, takže appka funguje
 * i bez internetu a bez GitHubu.
 */
function UpdateSection() {
  const { toast } = useToast();
  const [url, setUrl] = React.useState("");
  const [current, setCurrent] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    setUrl(getUpdateUrl());
    setCurrent(currentBundleVersion());
    setPending(pendingBundleVersion());
  }, []);

  const onCheck = async () => {
    setUpdateUrl(url);
    setChecking(true);
    const res = await checkForUpdate();
    setChecking(false);
    setPending(pendingBundleVersion());

    if (res.kind === "downloaded") {
      toast({
        tone: "win",
        title: `Aktualizace ${res.version} stažena`,
        description: "Nasadí se po zavření a otevření appky.",
      });
    } else if (res.kind === "up-to-date") {
      toast({ tone: "info", title: "Máš nejnovější verzi" });
    } else if (res.kind === "disabled") {
      toast({ tone: "warn", title: "Chybí adresa aktualizací" });
    } else {
      toast({ tone: "warn", title: "Aktualizace se nepovedla", description: res.message });
    }
  };

  return (
    <Section
      title="Aktualizace"
      hint="Appka si při startu sama stáhne novou verzi. Nové APK je potřeba jen při zásahu do nativní části."
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Adresa manifestu</span>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setUpdateUrl(url)}
          placeholder="https://raw.githubusercontent.com/…/latest.json"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={checking} onClick={onCheck}>
          <RefreshCw className={cn(checking && "animate-spin")} />
          {checking ? "Hledám…" : "Zkontrolovat teď"}
        </Button>
        <span className="tabular text-xs text-muted-foreground">
          {pending ? `čeká ${pending}` : current ? `verze ${current}` : "verze z APK"}
        </span>
      </div>

      {current || pending ? (
        <button
          type="button"
          onClick={async () => {
            await revertToBundled();
            setCurrent(null);
            setPending(null);
            toast({ tone: "info", title: "Zpět na verzi z APK", description: "Restartuj appku." });
          }}
          className="self-start px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Vrátit se k verzi z APK
        </button>
      ) : null}
    </Section>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
      {hint ? <p className="px-1 text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className="tabular text-base font-semibold">{value}</dd>
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
    </div>
  );
}

function ThemeChoice() {
  const [dark, setDark] = React.useState(true);

  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const set = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    void syncStatusBar(next);
    try {
      localStorage.setItem("microwins:theme", next ? "dark" : "light");
    } catch {
      // soukromý režim - téma se nezapamatuje
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        { value: true, label: "Tmavé", icon: Moon },
        { value: false, label: "Světlé", icon: Sun },
      ].map(({ value, label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => set(value)}
          aria-pressed={dark === value}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors",
            dark === value
              ? "border-foreground/40 bg-accent font-medium"
              : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          <Icon className="size-4" />
          {label}
          {dark === value ? <ChevronRight className="ml-auto size-3.5 opacity-40" /> : null}
        </button>
      ))}
    </div>
  );
}
