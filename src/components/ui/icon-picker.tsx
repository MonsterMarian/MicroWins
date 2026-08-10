"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LUCIDE_ICONS } from "@/components/ui/lucide-map";
import {
  EMOJI_GROUPS,
  LUCIDE_GROUPS,
  filterGroups,
  lucideNameOf,
  lucideRef,
  type IconGroup,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Výběr ikony ze 500+ možností.
 *
 * Mřížka se schválně nerozlévá do formuláře - v dialogu je jen jedno tlačítko
 * s aktuální ikonou a všechno ostatní se otevře v samostatném okně. Emoji
 * a kreslené ikony jsou dvě záložky téhož výběru, ukládají se do stejného
 * pole (kreslené s předponou `lucide:`).
 */

/** Vykreslí ikonu entity - emoji jako text, kreslenou jako komponentu. */
export function EntityIcon({
  icon,
  className,
  size = "md",
}: {
  icon: string;
  className?: string;
  /** Kreslená ikona nemá vlastní velikost jako emoji, musí se říct. */
  size?: "sm" | "md" | "lg";
}) {
  const name = lucideNameOf(icon);
  const Lucide = name ? LUCIDE_ICONS[name] : undefined;

  if (Lucide) {
    return (
      <Lucide
        aria-hidden
        className={cn(
          size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5",
          "shrink-0",
          className,
        )}
      />
    );
  }

  // Neznámé jméno (třeba po ručním zásahu do zálohy) radši ukáže emoji-fallback
  // než aby spadlo na undefined komponentě.
  return <span className={className}>{name ? "📁" : icon}</span>;
}

type Tab = "emoji" | "lucide";

export function IconPicker({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (icon: string) => void;
}) {
  const [tab, setTab] = React.useState<Tab>(() => (lucideNameOf(value) ? "lucide" : "emoji"));
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setTab(lucideNameOf(value) ? "lucide" : "emoji");
    setQuery("");
  }, [open, value]);

  const groups = React.useMemo<IconGroup[]>(
    () => filterGroups(tab === "emoji" ? EMOJI_GROUPS : LUCIDE_GROUPS, query),
    [tab, query],
  );

  const pick = (raw: string) => {
    onChange(tab === "emoji" ? raw : lucideRef(raw));
    onOpenChange(false);
  };

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Vybrat ikonu"
      description="Emoji nebo kreslená ikona. Hledá se bez diakritiky."
      className="sm:max-w-lg"
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-1 rounded-lg bg-muted/60 p-1">
          {(
            [
              { id: "emoji", label: "Emoji" },
              { id: "lucide", label: "Kreslené" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                tab === t.id
                  ? "bg-card font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="beh, kava, penize…"
            autoComplete="off"
            spellCheck={false}
            className="pl-8 pr-8"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Smazat hledání"
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nic takového tu není. Zkus jiné slovo.
          </p>
        ) : (
          <div className="scroll-quiet -mx-1 max-h-[46dvh] overflow-y-auto px-1">
            {groups.map((g) => (
              <section key={g.label} className="mb-3 last:mb-0">
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </h4>
                <div className="grid grid-cols-7 gap-1 sm:grid-cols-9">
                  {g.items.map((item) => {
                    const ref = tab === "emoji" ? item.value : lucideRef(item.value);
                    const active = ref === value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => pick(item.value)}
                        aria-pressed={active}
                        aria-label={item.keywords.split(" ")[0]}
                        title={item.keywords}
                        className={cn(
                          "grid aspect-square place-items-center rounded-md border text-lg transition-colors",
                          active
                            ? "border-progress bg-progress-muted"
                            : "border-transparent hover:bg-accent",
                        )}
                      >
                        <EntityIcon icon={ref} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Políčko do formuláře: ukáže vybranou ikonu a otevře výběr. Vedle je pár
 * nedávno použitých, aby se u běžných projektů nemuselo nic otevírat.
 */
export function IconField({
  value,
  onChange,
  quick,
}: {
  value: string;
  onChange: (icon: string) => void;
  /** Rychlá volba vedle tlačítka. */
  quick?: string[];
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid size-11 shrink-0 place-items-center rounded-md border border-progress bg-progress-muted text-xl"
          aria-label="Vybrat ikonu"
        >
          <EntityIcon icon={value} size="lg" />
        </button>

        {quick?.length ? (
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {quick
              .filter((q) => q !== value)
              .slice(0, 6)
              .map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onChange(q)}
                  className="grid size-9 place-items-center rounded-md border text-lg transition-colors hover:bg-accent"
                  aria-label={`Ikona ${q}`}
                >
                  <EntityIcon icon={q} />
                </button>
              ))}
          </div>
        ) : null}

        <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => setOpen(true)}>
          Všechny ikony
        </Button>
      </div>

      <IconPicker open={open} onOpenChange={setOpen} value={value} onChange={onChange} />
    </>
  );
}
