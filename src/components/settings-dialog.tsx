"use client";

import * as React from "react";
import { Check, ChevronRight, Moon, RefreshCw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePrefs, setPrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { ACCENTS, ADDONS } from "@/lib/prefs";
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
import { cn } from "@/lib/utils";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<"main" | "addons">("main");
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
      description="Vzhled a chování appky."
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-1 border-b">
          <button
            type="button"
            onClick={() => setActiveTab("main")}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              activeTab === "main"
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Hlavní
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("addons")}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              activeTab === "addons"
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Addony
          </button>
        </div>

        {activeTab === "main" ? (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section title="Vzhled">
              <ThemeChoice />
              <HeaderLogoChoice />
            </Section>

            <Section title="Barva postupu" hint="Jantar u microwinů zůstává v obou případech.">
              <AccentChoice />
            </Section>

            {native ? <UpdateSection /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section title="Addony" hint="Vypnutá část zmizí i se svou záložkou; data zůstanou.">
              <AddonChoice />
            </Section>
          </div>
        )}
      </div>
    </Dialog>
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
