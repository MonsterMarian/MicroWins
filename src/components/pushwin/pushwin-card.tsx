"use client";

import * as React from "react";
import { CalendarClock, Check, Sparkles, Trophy, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { formatDate, weekEnd, weekStart } from "@/lib/date";
import {
  activePushWin,
  canDraw,
  candidates,
  evaluatePushWin,
  isUnlocked,
  pushWinPath,
  pushWinsOfWeek,
  DIFFICULTY_LABEL,
  KIND_LABEL,
} from "@/lib/pushwin";
import type { PushWin } from "@/lib/types";
import { cn, formatNumber, plural } from "@/lib/utils";

/**
 * Týdenní výzva na obrazovce microwinů.
 *
 * Když je vypnutá nebo zamčená, karta se nekreslí vůbec - PushWin je hra
 * navíc, ne další povinný panel.
 */
export function PushWinCard() {
  const { state, today } = useStore();
  const { pushWins: enabled } = usePrefs();

  const unlocked = isUnlocked(state);
  const active = activePushWin(state, today);
  const week = pushWinsOfWeek(state, weekStart(today));

  if (!unlocked || !enabled) {
    return null;
  }

  return (
    <Card className="border-win/30 bg-gradient-to-br from-win-muted/30 to-background">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-win" />
              PushWin
            </CardTitle>
            <CardDescription>
              Týdenní výzva kousek za tím, co už jsi dokázal. Do {formatDate(weekEnd(today))}.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {active ? <RunningPush push={active} /> : <DrawPanel />}

        {week
          .filter((p) => p.completedAt !== null)
          .map((p) => (
            <DonePush key={p.id} push={p} />
          ))}
      </CardContent>
    </Card>
  );
}

// --- losování ---------------------------------------------------------------

/** Kolik políček proběhne, než se pás zastaví. */
const REEL = 28;

function DrawPanel() {
  const { state, today, drawPushWin } = useStore();
  const { pushOdds } = usePrefs();
  const { toast } = useToast();
  const [spinning, setSpinning] = React.useState(false);
  const [reel, setReel] = React.useState<string[]>([]);

  const availability = canDraw(state, today);

  /* Losování je jediné místo v appce, kde je ozdoba schválně delší, než by
     musela být - napětí je celý smysl. Pás se skládá z opravdových kandidátů,
     takže i než dojede, ukazuje pravdu o tom, co může padnout. */
  const spin = () => {
    const pool = [
      ...candidates(state, "easy", today),
      ...candidates(state, "medium", today),
      ...candidates(state, "hard", today),
    ];
    if (pool.length === 0) {
      toast({
        tone: "warn",
        title: "Není z čeho losovat",
        description: "Zapisuj dál - výzva se staví z tvojí historie.",
      });
      return;
    }

    setSpinning(true);
    setReel(Array.from({ length: REEL }, (_, i) => pool[(i * 7) % pool.length].text));

    window.setTimeout(() => {
      const drawn = drawPushWin();
      setSpinning(false);
      setReel([]);
      if (drawn) {
        toast({ tone: "win", title: "Výzva vylosována", description: drawn.text });
      } else {
        toast({ tone: "warn", title: "Losování se nepovedlo" });
      }
    }, 2600);
  };

  if (spinning) {
    return (
      <div className="relative h-14 overflow-hidden rounded-xl border bg-muted/40">
        {/* Značka uprostřed - políčko, které pod ní zůstane, je výsledek. */}
        <span className="absolute inset-y-0 left-1/2 z-10 w-0.5 -translate-x-1/2 bg-win" />
        <div className="mw-reel flex h-full items-center gap-2 whitespace-nowrap">
          {reel.map((text, i) => (
            <span
              key={i}
              className="grid h-10 min-w-44 place-items-center rounded-lg border bg-card px-3 text-xs"
            >
              {text}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (!availability.can) {
    return (
      <p className="text-sm text-muted-foreground">
        {availability.reason === "spent"
          ? "Losování na tenhle týden je pryč. Další v pondělí."
          : "Nejdřív dojeď rozdělanou výzvu."}
      </p>
    );
  }

  const total = pushOdds.easy + pushOdds.medium + pushOdds.hard;
  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={spin} className="h-12">
        <Sparkles /> Vylosovat výzvu
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {availability.left} {plural(availability.left, "losování", "losování", "losování")} tenhle
        týden · {pct(pushOdds.easy)} / {pct(pushOdds.medium)} / {pct(pushOdds.hard)} %
      </p>
    </div>
  );
}

// --- běžící výzva -----------------------------------------------------------

function RunningPush({ push }: { push: PushWin }) {
  const { state, today } = useStore();
  const progress = evaluatePushWin(state, push);
  const percent = push.target > 0 ? Math.min(100, (progress.current / push.target) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{KIND_LABEL[push.kind]}</Badge>
        <Badge
          variant="outline"
          className={cn(
            push.difficulty === "hard" && "border-destructive/40 text-destructive",
            push.difficulty === "medium" && "border-win/50 text-win-muted-foreground",
          )}
        >
          {DIFFICULTY_LABEL[push.difficulty]}
        </Badge>
        <span className="tabular ml-auto text-xs text-muted-foreground">
          <CalendarClock className="mr-1 inline size-3" />
          do {formatDate(weekEnd(today))}
        </span>
      </div>

      <p className="text-base font-medium">{push.text}</p>

      <ProgressBar value={percent} size="lg" tone="win" />

      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="tabular">
          {formatNumber(progress.current)} / {formatNumber(push.target)}
        </span>
        <span className="truncate pl-2">{pushWinPath(state, push)}</span>
      </div>
    </div>
  );
}

function DonePush({ push }: { push: PushWin }) {
  const { state } = useStore();

  return (
    <div className="flex items-start gap-3 rounded-xl border border-progress/40 bg-progress-muted/20 p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-progress text-progress-foreground">
        <Check className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{push.text}</p>
        <p className="text-xs text-muted-foreground">
          {DIFFICULTY_LABEL[push.difficulty]} · splněno
          {push.microwinIds.length > 0
            ? ` · ${push.microwinIds.length} ${plural(push.microwinIds.length, "microwin", "microwiny", "microwinů")}`
            : ""}
        </p>
      </div>
      <Trophy className="size-4 shrink-0 text-win" />
      <span className="sr-only">{pushWinPath(state, push)}</span>
    </div>
  );
}
