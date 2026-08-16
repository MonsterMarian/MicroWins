"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ClipboardPaste,
  Download,
  Moon,
  RefreshCw,
  Sun,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs, setPrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { parseBackup } from "@/lib/backup";
import { ACCENTS, ADDONS, HUB_TABS, OVERVIEWS, type HubTab } from "@/lib/prefs";
import {
  countState,
  hasScope,
  mergeState,
  type ImportMode,
  type ImportScope,
} from "@/lib/import";
import type { MicroWinsState } from "@/lib/types";
import {
  applyPendingUpdate,
  checkForUpdate,
  currentBundleVersion,
  DEFAULT_UPDATE_URL,
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
  const { state, exportJson, importJson } = useStore();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  /** Záloha čekající na potvrzení - viz `offerImport`. */
  const [pending, setPending] = React.useState<PendingImport | null>(null);

  const [native, setNative] = React.useState(false);

  React.useEffect(() => setNative(isNative()), []);
  React.useEffect(() => {
    if (!open) {
      setPasteOpen(false);
      setPasted("");
      setPending(null);
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

  /**
   * Záloha se nenačte rovnou - napřed se ukáže, co v ní je a co se se
   * současnými daty stane. Import umí smazat práci několika měsíců, tohle je
   * poslední místo, kde to jde zastavit.
   */
  const offerImport = (text: string, source: string) => {
    const parsed = parseBackup(text);
    if (!parsed) {
      toast({
        tone: "warn",
        title: "Soubor nejde načíst",
        description: "Nevypadá jako záloha MicroWins.",
      });
      return;
    }
    setPending({ text, source, incoming: parsed.state });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    offerImport(await file.text(), file.name);
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
          <HeaderLogoChoice />
        </Section>

        <Section title="Barva postupu" hint="Jantar u microwinů zůstává v obou případech.">
          <AccentChoice />
        </Section>

        <Section title="Úvodní obrazovka" hint="Stejná data, jiná otázka. Přepíná záložku Přehled.">
          <OverviewChoice />
        </Section>

        <Section title="Addony" hint="Vypnutá část zmizí i se svou záložkou; data zůstanou.">
          <AddonChoice />
        </Section>

        <Section title="Pořadí záložek" hint="Zleva doprava nad projekty. Vypnuté addony se přeskočí.">
          <TabOrderChoice />
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
                  onClick={() => offerImport(pasted, "vložený text")}
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
      </div>

      {pending ? (
        <ImportDialog
          pending={pending}
          onClose={() => setPending(null)}
          onConfirm={(scope, mode, summary) => {
            if (importJson(pending.text, { scope, mode })) {
              toast({ tone: "info", title: "Data načtena", description: summary });
              setPending(null);
              onOpenChange(false);
            } else {
              toast({ tone: "warn", title: "Načtení selhalo" });
            }
          }}
        />
      ) : null}
    </Dialog>
  );
}

interface PendingImport {
  text: string;
  /** Odkud data přišla - jméno souboru nebo "vložený text". */
  source: string;
  incoming: MicroWinsState;
}

const SCOPES: { id: ImportScope; label: string; hint: string }[] = [
  { id: "all", label: "Vše", hint: "strom i projekty" },
  { id: "projects", label: "Jen projekty", hint: "strom winů zůstane beze změny" },
  { id: "tree", label: "Jen strom", hint: "projekty zůstanou beze změny" },
];

const MODES: { id: ImportMode; label: string; hint: string }[] = [
  { id: "add", label: "Přidat", hint: "nic se nesmaže, data se připojí" },
  { id: "replace", label: "Nahradit", hint: "vybraná část se přepíše zálohou" },
];

/**
 * Náhled importu: co je v souboru, co se s tím stane a co zůstane.
 * Počty "po importu" se počítají skutečným sloučením, ne odhadem - co je
 * v náhledu, to se opravdu uloží.
 */
function ImportDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: PendingImport;
  onClose: () => void;
  onConfirm: (scope: ImportScope, mode: ImportMode, summary: string) => void;
}) {
  const { state } = useStore();
  const incoming = React.useMemo(() => countState(pending.incoming), [pending.incoming]);

  // Když záloha nese jen jednu polovinu, není co vybírat.
  const [scope, setScope] = React.useState<ImportScope>(() => {
    if (!hasScope(incoming, "tree")) return "projects";
    if (!hasScope(incoming, "projects")) return "tree";
    return "all";
  });
  const [mode, setMode] = React.useState<ImportMode>("add");

  const before = React.useMemo(() => countState(state), [state]);
  const after = React.useMemo(
    () => countState(mergeState(state, pending.incoming, scope, mode)),
    [state, pending.incoming, scope, mode],
  );

  const touchesTree = scope !== "projects";
  const touchesProjects = scope !== "tree";
  const summary = `${pending.source} · ${SCOPES.find((s) => s.id === scope)?.label.toLowerCase()}`;

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Načíst zálohu"
      description={pending.source}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Zrušit
          </Button>
          <Button
            variant={mode === "replace" ? "destructive" : "default"}
            disabled={!hasScope(incoming, scope)}
            onClick={() => onConfirm(scope, mode, summary)}
          >
            {mode === "replace" ? "Nahradit" : "Přidat"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            V souboru
          </p>
          <p className="text-sm">
            {incoming.projects} {plural(incoming.projects, "projekt", "projekty", "projektů")},{" "}
            {incoming.tasks} {plural(incoming.tasks, "úkol", "úkoly", "úkolů")} ·{" "}
            {incoming.folders} {plural(incoming.folders, "složka", "složky", "složek")},{" "}
            {incoming.wins} {plural(incoming.wins, "win", "winy", "winů")}
          </p>
        </div>

        <Choice
          label="Co načíst"
          options={SCOPES}
          value={scope}
          onChange={setScope}
          disabledIds={SCOPES.filter((s) => !hasScope(incoming, s.id)).map((s) => s.id)}
        />
        <Choice label="Jak" options={MODES} value={mode} onChange={setMode} />

        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Po načtení
          </p>
          <Change
            label="Projekty"
            from={before.projects}
            to={after.projects}
            touched={touchesProjects}
          />
          <Change label="Úkoly" from={before.tasks} to={after.tasks} touched={touchesProjects} />
          <Change label="Složky" from={before.folders} to={after.folders} touched={touchesTree} />
          <Change label="Winy" from={before.wins} to={after.wins} touched={touchesTree} />
          <Change
            label="Microwiny"
            from={before.microwins}
            to={after.microwins}
            touched={touchesTree}
          />
        </div>

        {mode === "replace" ? (
          <p className="text-xs text-destructive">
            Nahrazení je nevratné. {scope === "projects" ? "Stávající projekty a úkoly zmizí." : null}
            {scope === "tree" ? "Stávající strom, záznamy i microwiny zmizí." : null}
            {scope === "all" ? "Všechna současná data zmizí." : null}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabledIds = [],
}: {
  label: string;
  options: { id: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  disabledIds?: T[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {options.map((o) => {
        const disabled = disabledIds.includes(o.id);
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              active
                ? "border-foreground/40 bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent/50",
              disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
            )}
          >
            <span className="shrink-0">{o.label}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {disabled ? "v souboru není" : o.hint}
            </span>
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

  /**
   * Nasazení na klepnutí. Při startu běží samo, ale když se tam něco pokazí,
   * uživatel to nemá jak zjistit - takhle chybu aspoň uvidí.
   */
  const onApply = async () => {
    const res = await applyPendingUpdate();
    if (res.error) {
      toast({ tone: "warn", title: "Nasazení selhalo", description: res.error });
      setPending(pendingBundleVersion());
      setCurrent(currentBundleVersion());
    } else if (!res.applied) {
      toast({ tone: "info", title: "Tahle verze už běží" });
      setPending(null);
    }
    // Když se nasadilo, appka se právě překresluje - toast by nikdo neviděl.
  };

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
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Adresa manifestu {url === DEFAULT_UPDATE_URL ? "(výchozí)" : "(vlastní)"}
        </summary>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setUpdateUrl(url)}
          placeholder={DEFAULT_UPDATE_URL}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 font-mono text-xs"
        />
        {url !== DEFAULT_UPDATE_URL ? (
          <button
            type="button"
            onClick={() => {
              setUrl(DEFAULT_UPDATE_URL);
              setUpdateUrl(DEFAULT_UPDATE_URL);
            }}
            className="mt-1.5 text-muted-foreground hover:text-foreground"
          >
            Vrátit výchozí adresu
          </button>
        ) : null}
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={checking} onClick={onCheck}>
          <RefreshCw className={cn(checking && "animate-spin")} />
          {checking ? "Hledám…" : "Zkontrolovat teď"}
        </Button>
        {pending ? (
          <Button size="sm" onClick={onApply}>
            Nasadit {pending}
          </Button>
        ) : null}
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

/**
 * Vypínatelné části appky. Seznam jede z `ADDONS`, takže druhý addon je jeden
 * řádek v `prefs.ts` a tahle obrazovka se ho nemusí ani dotknout.
 */
function AddonChoice() {
  const { addons } = usePrefs();

  return (
    <div className="flex flex-col gap-2">
      {ADDONS.map((addon) => {
        const on = addons[addon.id];
        return (
          <button
            key={addon.id}
            type="button"
            onClick={() => setPrefs({ addons: { ...addons, [addon.id]: !on } })}
            aria-pressed={on}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
              on ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{addon.label}</span>
              <span className="block text-xs text-muted-foreground">{addon.hint}</span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                on ? "bg-progress" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 size-4 rounded-full bg-card shadow transition-[left] duration-200",
                  on ? "left-6" : "left-1",
                )}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pořadí záložek. Šipky, ne přetahování: seznam má tři položky a v dialogu,
 * který se sám posouvá, by se táhlo špatně.
 */
function TabOrderChoice() {
  const { tabOrder } = usePrefs();

  const move = (index: number, direction: -1 | 1) => {
    const next = [...tabOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPrefs({ tabOrder: next });
  };

  const label = (id: HubTab) => HUB_TABS.find((t) => t.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-1.5">
      {tabOrder.map((id, index) => (
        <div key={id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="tabular w-4 shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate font-medium">{label(id)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Posunout ${label(id)} doleva`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Posunout ${label(id)} doprava`}
            disabled={index === tabOrder.length - 1}
            onClick={() => move(index, 1)}
          >
            <ArrowDown />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Zelená / bílá. Náhledem je pruh - přesně to místo, kde barva rozhoduje. */
function AccentChoice() {
  const { accent } = usePrefs();

  return (
    <div className="grid grid-cols-2 gap-2">
      {ACCENTS.map((a) => {
        const active = accent === a.id;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => setPrefs({ accent: a.id })}
            aria-pressed={active}
            className={cn(
              "flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
              active ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="flex items-center gap-2 text-sm">
              <span className={cn("font-medium", !active && "text-muted-foreground")}>{a.label}</span>
              {active ? <Check className="ml-auto size-3.5 opacity-60" /> : null}
            </span>
            {/* Náhled nesmí poslouchat aktuální volbu, jinak by obě dlaždice
                ukazovaly totéž - proto vlastní třída, ne --progress. */}
            <span className="h-2 w-full overflow-hidden rounded-full bg-track">
              <span
                className={cn(
                  "block h-full w-2/3 rounded-full",
                  a.id === "green" ? "mw-swatch-green" : "mw-swatch-white",
                )}
              />
            </span>
            <span className="text-xs text-muted-foreground">{a.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function OverviewChoice() {
  const { overview } = usePrefs();

  return (
    <div className="flex flex-col gap-1.5">
      {OVERVIEWS.map((o) => {
        const active = overview === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setPrefs({ overview: o.id })}
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

/** Logo z fotky v hlavičce - zapnuté/vypnuté, ať jde porovnat se současným. */
function HeaderLogoChoice() {
  const { headerLogo } = usePrefs();

  return (
    <button
      type="button"
      onClick={() => setPrefs({ headerLogo: !headerLogo })}
      aria-pressed={headerLogo}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        headerLogo ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">Logo v hlavičce</span>
        <span className="block text-xs text-muted-foreground">
          Nová ikonka vedle názvu; ikonu appky mění vždy.
        </span>
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-new.jpg"
        alt=""
        className={cn("size-7 shrink-0 rounded-lg object-cover", !headerLogo && "opacity-40")}
      />
    </button>
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
