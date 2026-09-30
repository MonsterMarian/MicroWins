"use client";

import * as React from "react";
import {
  Check,
  ChevronRight,
  Download,
  ListChecks,
  LogIn,
  LogOut,
  Merge,
  Moon,
  RefreshCw,
  Save,
  Share2,
  Sun,
  Upload,
  Trophy,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs, setPrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { useAccount } from "@/components/providers/use-account";
import { useSyncStatus } from "@/components/providers/use-sync";
import { LoginDialog } from "@/components/account/login-dialog";
import { signOut } from "@/lib/account";
import {
  progressLabel,
  progressPercent,
  reopenAdoption,
  syncNow,
  type SyncStatus,
} from "@/lib/sync-runtime";
import { ProgressBar } from "@/components/ui/progress";
import { ADDON_PART, describePart, type DataPart } from "@/lib/parts";
import { ACCENTS, ADDONS, PLAN_VIEWS, TIMEBOX_LAYOUTS, TODO_TTL_CHOICES } from "@/lib/prefs";
import { timeboxRowCount } from "@/lib/timebox";
import {
  AI_PROVIDERS,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  getAiKey,
  getAiModel,
  getAiProvider,
  setAiKey,
  setAiModel,
  setAiProvider,
  type AiProvider,
} from "@/lib/ai";
import {
  ExportDialog,
  ImportDialog,
  useBackupPicker,
  useExport,
  type PendingImport,
} from "./settings/backup-dialogs";
import { DueRulesSection } from "./settings/due-rules-section";
import { formatDuration } from "@/lib/todos";
import { logoImage } from "@/lib/logo-image";
import {
  applyPendingUpdate,
  checkForUpdate,
  currentBundleVersion,
  DEFAULT_UPDATE_URL,
  getUpdateUrl,
  pendingBundleVersion,
  setUpdateUrl,
} from "@/lib/live-update";
import { isNative, syncStatusBar } from "@/lib/native";
import { cn, plural } from "@/lib/utils";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<Tab>("main");
  const [native, setNative] = React.useState(false);

  React.useEffect(() => setNative(isNative()), []);
  React.useEffect(() => {
    if (!open) {
      setActiveTab("main");
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nastavení"
      description="Vzhled, data a chování appky."
      fullScreen
      /*
        Místo pod obsahem, ať se dá vytáhnout nahoru.
        Poslední přepínač sedí u dolní hrany přesně tam, kde má čtenář palec,
        kterým roluje - přečíst ho znamenalo dívat se pod vlastní ruku. S touhle
        rezervou se konec kterékoli záložky dá odrolovat do pohodlné výšky.
      */
      className="pb-[calc(33dvh+var(--mw-safe-bottom))]"
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-1 border-b">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                activeTab === tab.id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "main" ? (
          <div className="flex flex-col gap-5 animate-in-up">
            <AccountSection />
            <DataSection native={native} onImported={() => onOpenChange(false)} />
            {native ? (
              <UpdateSection />
            ) : null}
          </div>
        ) : activeTab === "appearance" ? (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section title="Vzhled">
              <ThemeChoice />
              <HeaderLogoChoice />
              <FolderTrophyChoice />
            </Section>

            <Section title="Barva postupu" hint="Jantar u microwinů zůstává v obou případech.">
              <AccentChoice />
            </Section>

            <PlanChoice />
            <TimeboxLayoutChoice />
          </div>
        ) : (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section
              title="Addony"
              hint="Vypnutá část zmizí i se svou záložkou; data zůstanou. Appka se otevírá na první záložce zleva - pořadí si přetáhneš přímo v liště nad projekty. Uložit a Načíst pod addonem sahají jen na jeho data."
            >
              <AddonChoice onImported={() => onOpenChange(false)} />
            </Section>

            <TimeboxHoursSection />
            <AiKeySection />
            <TodoExpirySection />
            <TodoDueSection />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function FolderTrophyChoice() {
  const { folderTrophy } = usePrefs();

  return (
    <button
      type="button"
      onClick={() => setPrefs({ folderTrophy: !folderTrophy })}
      aria-pressed={folderTrophy}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        folderTrophy ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Poháry u složek</span>
        <span className="block text-xs text-muted-foreground">
          Místo slova "microwinů" ukáže ikonu poháru. Oranžově se rozsvítí, pokud v daný den přibyl microwin.
        </span>
      </span>
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md border",
          folderTrophy ? "border-foreground/30 bg-background" : "border-transparent bg-background/50",
        )}
      >
        <Trophy className={cn("size-4", folderTrophy ? "text-win" : "text-muted-foreground")} />
      </div>
    </button>
  );
}

type Tab = "main" | "appearance" | "addons";

const TABS: { id: Tab; label: string }[] = [
  { id: "main", label: "Hlavní" },
  { id: "appearance", label: "Vzhled" },
  { id: "addons", label: "Addony" },
];

/**
 * Účet. Nahoře v Nastavení, protože s ním souvisí všechno pod ním - záloha
 * je jedna cesta, jak dostat data z telefonu, účet je ta druhá.
 *
 * Odhlášení se neptá: nic nemaže, data v telefonu zůstávají a změny z doby
 * bez přihlášení odejdou po dalším přihlášení.
 */
function AccountSection() {
  const account = useAccount();
  const sync = useSyncStatus();
  const { toast } = useToast();
  const [loginOpen, setLoginOpen] = React.useState(false);
  const signedIn = account.status === "signed-in";

  const line = signedIn
    ? syncLine(sync)
    : account.status === "off"
      ? "Data jsou jen v tomhle zařízení. Účty se zapnou po napojení databáze."
      : account.status === "loading"
        ? "Zjišťuju přihlášení…"
        : "Data jsou jen v tomhle zařízení.";

  return (
    <Section title="Účet">
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold",
              signedIn ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {signedIn && account.email ? (
              account.email.slice(0, 1).toUpperCase()
            ) : (
              <UserRound className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {signedIn ? account.email || "Přihlášeno" : "Bez účtu"}
            </span>
            <span
              className={cn(
                "block text-xs",
                signedIn && sync.phase === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {line}
            </span>
          </span>
          {account.status === "loading" ? null : signedIn ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await signOut();
                toast({ tone: "info", title: "Odhlášeno", description: "Data v telefonu zůstala." });
              }}
            >
              <LogOut /> Odhlásit
            </Button>
          ) : (
            <Button
              size="sm"
              variant={account.status === "off" ? "outline" : "default"}
              onClick={() => setLoginOpen(true)}
            >
              <LogIn /> Přihlásit
            </Button>
          )}
        </div>

        {/* Průběh přenosu i tady - kdo se dívá do Nastavení, chce vidět, kolik zbývá. */}
        {signedIn && sync.progress && progressPercent(sync.progress) !== null ? (
          <div className="px-3 pb-2.5">
            <ProgressBar value={progressPercent(sync.progress) ?? 0} size="sm" quiet />
          </div>
        ) : null}

        {/* Stejná patička jako u addonů - akce, které se nedělají každý den. */}
        {signedIn && sync.phase !== "off" && sync.phase !== "checking" ? (
          <div className="flex items-center gap-1 border-t px-1.5 py-1">
            {sync.phase === "needs-adoption" ? (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={reopenAdoption}>
                <Merge className="size-3.5" /> Spojit data s účtem
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={sync.phase === "syncing"}
                onClick={() => void syncNow()}
              >
                <RefreshCw className={cn("size-3.5", sync.phase === "syncing" && "animate-spin")} />
                Synchronizovat
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </Section>
  );
}

/** Jedna věta o tom, jak na tom synchronizace je. */
function syncLine(sync: SyncStatus): string {
  const waiting =
    sync.pending > 0
      ? ` · ${sync.pending} ${plural(sync.pending, "změna čeká", "změny čekají", "změn čeká")}`
      : "";
  switch (sync.phase) {
    case "checking":
      return sync.progress ? progressLabel(sync.progress) : "Zjišťuju, co je v účtu…";
    case "needs-adoption":
      return "Data z tohohle zařízení ještě nejsou v účtu.";
    case "syncing":
      return sync.progress ? progressLabel(sync.progress) : "Synchronizuju…";
    case "offline":
      return `Bez připojení - změny odejdou později${waiting}`;
    case "error":
      return sync.message ?? "Synchronizace se nepovedla.";
    case "idle":
      return sync.lastSyncAt
        ? `Synchronizováno v ${new Date(sync.lastSyncAt).toLocaleTimeString("cs-CZ", {
            hour: "2-digit",
            minute: "2-digit",
          })}${waiting}`
        : `Synchronizace zapnutá${waiting}`;
    default:
      return "Připojuju…";
  }
}

/**
 * Záloha a obnova. "Poslat" a "Uložit" berou celý stav včetně nastavení (viz
 * `lib/backup.ts`), takže odsud vypadne úplně všechno, co appka drží - ne jen
 * to, co je zrovna vidět na obrazovce. Kdo chce jen kus, vybere si ho.
 */
function DataSection({ native, onImported }: { native: boolean; onImported: () => void }) {
  const { busy, run } = useExport();
  const [choosing, setChoosing] = React.useState(false);
  /** Záloha čekající na potvrzení - import umí smazat práci několika měsíců. */
  const [pending, setPending] = React.useState<PendingImport | null>(null);
  const picker = useBackupPicker(setPending);

  return (
    <>
      <Section title="Záloha">
        {/* V appce má smysl vybrat si doručení, v prohlížeči vede všechno na
            stažení - jedno tlačítko tam říká pravdu líp než dvě. */}
        {native ? (
          <>
            <Button
              variant="outline"
              className="justify-start"
              disabled={busy !== null}
              onClick={() => run("share")}
            >
              <Share2 /> {busy === "share" ? "Připravuju zálohu…" : "Poslat zálohu"}
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              disabled={busy !== null}
              onClick={() => run("save")}
            >
              <Save /> {busy === "save" ? "Ukládám…" : "Uložit do telefonu"}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="justify-start"
            disabled={busy !== null}
            onClick={() => run("share")}
          >
            <Download /> {busy ? "Připravuju zálohu…" : "Exportovat vše"}
          </Button>
        )}

        <Button variant="outline" className="justify-start" onClick={() => setChoosing(true)}>
          <ListChecks /> Uložit jen část…
        </Button>
        <Button variant="outline" className="justify-start" onClick={() => picker.open()}>
          <Upload /> Obnovit ze souboru
        </Button>
        {picker.input}

        <p className="px-1 text-xs text-muted-foreground">
          {native
            ? "Poslat = vybereš appku, kam záloha odletí (Disk, mail). Uložit = soubor zůstane v Dokumentech a vyřídíš si ho potom. "
            : ""}
          Obnova se napřed zeptá, které části ze souboru vzít a jestli je přidat, nebo nahradit.
        </p>
      </Section>

      <ExportDialog open={choosing} onOpenChange={setChoosing} />

      {pending ? (
        <ImportDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            onImported();
          }}
        />
      ) : null}
    </>
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

/**
 * Addony - vypínač a pod ním uložení a načtení jen jejich dat.
 *
 * Každý addon si ukládá svoje: ToDo seznam, Plán bloky, Time box priority
 * s brain dumpem i mřížkou. Atomy jsou úkoly, takže jdou s projekty; jednu
 * mapu uložíš i přímo nad ní. Přehled nic vlastního nemá, jen počítá.
 */
function AddonChoice({ onImported }: { onImported: () => void }) {
  const { addons } = usePrefs();
  const { state } = useStore();
  const [exporting, setExporting] = React.useState<DataPart | null>(null);
  const [pending, setPending] = React.useState<PendingImport | null>(null);
  const picker = useBackupPicker(setPending);

  return (
    <div className="flex flex-col gap-2">
      {ADDONS.map((addon) => {
        const on = addons[addon.id];
        const part = ADDON_PART[addon.id];
        return (
          <div
            key={addon.id}
            className={cn(
              "overflow-hidden rounded-lg border transition-colors",
              on && "border-foreground/40 bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => setPrefs({ addons: { ...addons, [addon.id]: !on } })}
              aria-pressed={on}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
                !on && "hover:bg-accent/50",
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

            {/* Data zůstávají i u vypnutého addonu, takže uložit jdou vždycky. */}
            {part ? (
              <div className="flex items-center gap-1 border-t border-foreground/10 px-1.5 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setExporting(part)}
                  aria-label={`Uložit ${addon.label} do souboru`}
                >
                  <Download className="size-3.5" /> Uložit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => picker.open([part])}
                  aria-label={`Načíst ${addon.label} ze souboru`}
                >
                  <Upload className="size-3.5" /> Načíst
                </Button>
                <span className="tabular ml-auto min-w-0 truncate pr-1.5 text-[11px] text-muted-foreground">
                  {addon.id === "atoms" ? "s projekty · " : ""}
                  {describePart(state, part)}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
      {picker.input}

      <ExportDialog
        open={exporting !== null}
        onOpenChange={(open) => !open && setExporting(null)}
        initial={exporting ? [exporting] : undefined}
      />

      {pending ? (
        <ImportDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            onImported();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Rozsah mřížky time boxu.
 *
 * Výchozích 5-23 sedí na papírovou předlohu, ale budíček ani večerka nejsou
 * pro každého stejné. Konec **před** začátkem je platná volba: mřížka pak
 * přeteče přes půlnoc a hodiny po ní patří dalšímu dni - přesně tak, jak se
 * v ten čas plánuje.
 */
function TimeboxHoursSection() {
  const { addons, timeboxStart, timeboxEnd } = usePrefs();
  if (!addons.timebox) return null;

  const rows = timeboxRowCount(timeboxStart, timeboxEnd);

  return (
    <Section
      title="Mřížka time boxu"
      hint="Konec před začátkem znamená mřížku přes půlnoc - hodiny po ní se plánují na další den."
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Od</span>
          <Select
            value={String(timeboxStart)}
            onChange={(e) => setPrefs({ timeboxStart: Number(e.target.value) })}
            aria-label="První hodina mřížky"
            className="h-8 w-auto text-xs"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Do</span>
          <Select
            value={String(timeboxEnd)}
            onChange={(e) => setPrefs({ timeboxEnd: Number(e.target.value) })}
            aria-label="Poslední hodina mřížky"
            className="h-8 w-auto text-xs"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:30
              </option>
            ))}
          </Select>
        </label>
        <span className="tabular text-xs text-muted-foreground">
          {rows} {plural(rows, "řádek", "řádky", "řádků")}
        </span>
      </div>
    </Section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Klíč ke Gemini pro návrhy z brain dumpu.
 *
 * Nebydlí v `prefs.ts` schválně: nastavení se celé propisuje do zálohy
 * (`backup.ts`) a záloha se posílá mailem nebo leží na disku, takže by z ní
 * klíč dřív nebo později vypadl někomu do rukou. Leží proto ve vlastním klíči
 * localStorage, zůstává na jednom zařízení a do zálohy se nedává.
 *
 * Uložený klíč se ani nevypisuje zpátky - z obrazovky jde jen přepsat nebo
 * smazat. Ukazovat ho není proč a je to o jedno místo míň, odkud se dá omylem
 * vyfotit nebo sdílet obrazovku.
 */
function AiKeySection() {
  const { addons } = usePrefs();
  const { toast } = useToast();
  const [provider, setProvider] = React.useState<AiProvider>(DEFAULT_PROVIDER);
  const [hasKey, setHasKey] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [model, setModel] = React.useState(DEFAULT_MODELS[DEFAULT_PROVIDER]);

  /** Klíč i model si drží každý poskytovatel svůj - přepnutí je jen přečte. */
  const load = React.useCallback((next: AiProvider) => {
    setProvider(next);
    setHasKey(getAiKey(next) !== "");
    setModel(getAiModel(next));
    setDraft("");
  }, []);

  React.useEffect(() => load(getAiProvider()), [load]);

  if (!addons.timebox) return null;

  const save = () => {
    const value = draft.trim();
    if (!value) return;
    setAiKey(value, provider);
    setDraft("");
    setHasKey(true);
    toast({ tone: "info", title: "Klíč uložený", description: "Zůstává jen v tomhle zařízení." });
  };

  return (
    <Section
      title="Návrhy z brain dumpu"
      hint="Klíč zůstává jen tady a do zálohy se nedává. Ven odchází samotný text brain dumpu, a jen když klikneš na Navrhnout."
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {AI_PROVIDERS.map((p) => {
            const active = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setAiProvider(p.id);
                  load(p.id);
                }}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left transition-colors",
                  active ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            placeholder={hasKey ? "Klíč je uložený - sem napiš nový" : `Klíč k ${provider === "claude" ? "Anthropic" : "Gemini"} API`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            aria-label="Klíč k API"
            className="h-8 flex-1 text-xs"
          />
          <Button size="sm" disabled={draft.trim() === ""} onClick={save}>
            Uložit
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Model</span>
          <Input
            value={model}
            spellCheck={false}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => setAiModel(model || DEFAULT_MODELS[provider], provider)}
            aria-label="Model"
            className="h-8 w-56 text-xs"
          />
          {hasKey ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto hover:text-destructive"
              onClick={() => {
                setAiKey("", provider);
                setHasKey(false);
                toast({ tone: "info", title: "Klíč smazaný" });
              }}
            >
              Smazat klíč
            </Button>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

/**
 * Mizení odškrtnutých položek ToDo.
 *
 * Šest hodin bylo do téhle chvíle napevno v kódu a nešlo s tím nic dělat -
 * komu položky mizely moc brzy (nebo pozdě), neměl kam sáhnout. Vypínač je
 * schválně nad dobou: zvolená doba se drží i po vypnutí, takže zpětné zapnutí
 * vrátí přesně to, co si člověk nastavil.
 *
 * Sekce zmizí spolu s vypnutým addonem ToDo - nastavovat něco, co není vidět,
 * je jen matoucí.
 */
function TodoExpirySection() {
  const { addons, todoExpire, todoTtlMinutes } = usePrefs();
  if (!addons.todo) return null;

  return (
    <Section
      title="Mizení v ToDo"
      hint="Odškrtnutá položka zůstane dole pod otevřenými a pak se smaže sama. Do té doby jde vrátit zpět."
    >
      <button
        type="button"
        onClick={() => setPrefs({ todoExpire: !todoExpire })}
        aria-pressed={todoExpire}
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
          todoExpire ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">Mazat odškrtnuté</span>
          <span className="block text-xs text-muted-foreground">
            {todoExpire
              ? `Zmizí za ${formatDuration(todoTtlMinutes * 60_000)}.`
              : "Nic nemizí, mažeš si sám."}
          </span>
        </span>
        <span
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            todoExpire ? "bg-progress" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "absolute top-1 size-4 rounded-full bg-card shadow transition-[left] duration-200",
              todoExpire ? "left-6" : "left-1",
            )}
          />
        </span>
      </button>

      {todoExpire ? (
        <div className="flex flex-wrap gap-1.5">
          {TODO_TTL_CHOICES.map((minutes) => {
            const active = todoTtlMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                onClick={() => setPrefs({ todoTtlMinutes: minutes })}
                aria-pressed={active}
                className={cn(
                  "tabular rounded-md border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-foreground/40 bg-accent font-medium"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {formatDuration(minutes * 60_000)}
              </button>
            );
          })}
        </div>
      ) : null}
    </Section>
  );
}

/**
 * Podoba plánu dne. Obě verze umí totéž a pracují se stejnými bloky, jen se
 * ptají jinak - proto volba, ne dvě obrazovky vedle sebe.
 */
function PlanChoice() {
  const { addons, plan } = usePrefs();
  if (!addons.plan) return null;

  return (
    <Section title="Plán dne">
      <div className="flex flex-col gap-2">
        {PLAN_VIEWS.map((view) => {
          const active = plan === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => setPrefs({ plan: view.id })}
              aria-pressed={active}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                active ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
              )}
            >
              <PlanPreview view={view.id} active={active} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {view.label}
                  {active ? <Check className="ml-auto size-3.5 opacity-60" /> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{view.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Drobná kresba místo screenshotu - rozdíl mezi verzemi je v rozvržení. */
function PlanPreview({ view, active }: { view: string; active: boolean }) {
  const bar = cn("rounded-[2px]", active ? "bg-foreground/70" : "bg-muted-foreground/40");
  return (
    <span
      className={cn(
        "grid h-10 w-10 shrink-0 gap-[3px] rounded-md border p-1.5",
        view === "week" ? "grid-cols-4 grid-rows-3" : "grid-cols-1 grid-rows-3",
      )}
      aria-hidden
    >
      {view === "week" ? (
        <>
          <span className={cn(bar, "row-span-2")} />
          <span className={bar} />
          <span className={cn(bar, "row-span-3 self-start h-full")} />
          <span className={bar} />
          <span className={cn(bar, "col-start-2 row-start-3")} />
        </>
      ) : (
        <>
          <span className={bar} />
          <span className={cn(bar, "opacity-40")} />
          <span className={bar} />
        </>
      )}
    </span>
  );
}

/**
 * Rozvržení time boxu. Všechny verze pracují se stejným listem dne, liší se
 * jen tím, kolik se ho vejde na výšku telefonu.
 */
function TimeboxLayoutChoice() {
  const { addons, timeboxLayout } = usePrefs();
  if (!addons.timebox) return null;

  return (
    <Section title="Time box">
      <div className="flex flex-col gap-2">
        {TIMEBOX_LAYOUTS.map((layout) => {
          const active = timeboxLayout === layout.id;
          return (
            <button
              key={layout.id}
              type="button"
              onClick={() => setPrefs({ timeboxLayout: layout.id })}
              aria-pressed={active}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                active ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
              )}
            >
              <TimeboxPreview layout={layout.id} active={active} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {layout.label}
                  {active ? <Check className="ml-auto size-3.5 opacity-60" /> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{layout.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Kresba rozvržení: čárka vlevo je čas, proužek vpravo zápis. */
function TimeboxPreview({ layout, active }: { layout: string; active: boolean }) {
  const bar = cn("rounded-[2px]", active ? "bg-foreground/70" : "bg-muted-foreground/40");
  const faint = cn(bar, "opacity-40");
  return (
    <span
      className="flex h-10 w-10 shrink-0 flex-col gap-[3px] rounded-md border p-1.5"
      aria-hidden
    >
      {layout === "sheet" ? (
        <span className="grid flex-1 grid-cols-2 gap-[3px]">
          <span className={bar} />
          <span className={faint} />
          <span className={faint} />
          <span className={bar} />
        </span>
      ) : layout === "tabs" ? (
        <>
          <span className="flex h-1 gap-[3px]">
            <span className={cn(bar, "flex-1")} />
            <span className={cn(faint, "flex-1")} />
          </span>
          <span className={cn(bar, "flex-1")} />
          <span className={cn(faint, "flex-1")} />
        </>
      ) : layout === "agenda" ? (
        <>
          <span className={cn(bar, "flex-1")} />
          <span className="h-px border-t border-dashed border-muted-foreground/50" />
          <span className={cn(bar, "flex-1")} />
        </>
      ) : (
        <>
          <span className={cn(bar, "flex-1")} />
          <span className={cn(faint, "flex-1")} />
          <span className={cn(bar, "flex-1")} />
          <span className={cn(faint, "flex-1")} />
        </>
      )}
    </span>
  );
}

/** Rychlé termíny mají smysl jen tam, kde je ToDo zapnuté. */
function TodoDueSection() {
  const { addons } = usePrefs();
  if (!addons.todo) return null;
  return <DueRulesSection />;
}

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
        src={logoImage}
        alt=""
        className={cn("size-7 shrink-0 object-contain", !headerLogo && "opacity-40")}
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
