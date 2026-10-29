import { cn } from "@/lib/utils";

/**
 * Pilulka přepínače. Jen ukazuje stav - klepe se na celý řádek kolem ní
 * (tlačítko s `aria-pressed`), ať je cíl pro prst velký.
 */
export function SwitchPill({ on }: { on: boolean }) {
  return (
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
  );
}
