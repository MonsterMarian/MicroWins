"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Fab } from "@/components/ui/fab";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, dayOfMonth, DAY_SHORT, formatDate, fromISODate, monthGenitive } from "@/lib/date";
import { tapFeedback } from "@/lib/native";
import {
  blocksOfDay,
  daySummary,
  DEFAULT_DURATION,
  formatLength,
  formatMinutes,
  nextFreeSlot,
  pinsOfDay,
  plannedMinutes,
  weekDays,
  type DuePin,
} from "@/lib/timeblocks";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { BlockDialog } from "./block-dialog";
import { DAY_PX_PER_MIN, DayView } from "./day-view";
import { Queue, type DropInput } from "./queue";
import { WeekView } from "./week-view";

/**
 * Plán dne - timeblocking.
 *
 * Otázka, na kterou obrazovka odpovídá, je jediná: **kdy na to bude čas?**
 * Proto tu nejsou procenta ani cíle - ty patří úkolům - a proto je všechno
 * postavené kolem jednoho gesta: vezmi něco rozdělaného a hoď to do dne.
 *
 * Podoby jsou dvě a přepínají se v Nastavení → Vzhled, protože se ptají jinak:
 * **osa dne** na „jak vypadá dnešek", **týden** na „kdy v tom týdnu na to bude
 * čas". Data jsou pod obojím stejná, včetně tažení bloků.
 *
 * Se seznamem ToDo je plán propojený **oběma směry**: položka s hodinou se
 * v mřížce ukáže jako čárkovaná stopa a ťuknutím se z ní stane blok; posunutí
 * bloku naopak přepíše termín položky. Je to jedna informace ze dvou stran -
 * dvě čísla, která si můžou odporovat, by byla horší než žádné.
 */
export function PlanPanel() {
  const { state, today, addBlock } = useStore();
  const { plan } = usePrefs();
  const { toast } = useToast();

  const [date, setDate] = React.useState<ISODate>(today);
  const [editing, setEditing] = React.useState<TimeBlock | null>(null);
  const [creating, setCreating] = React.useState<{ date: ISODate; start: number } | null>(null);

  const week = plan === "week";
  const isToday = date === today;
  const now = useNow();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const days = React.useMemo(() => weekDays(date), [date]);
  const blocks = React.useMemo(() => blocksOfDay(state, date), [state, date]);
  const pins = React.useMemo(() => pinsOfDay(state, date), [state, date]);

  const gridRef = React.useRef<HTMLDivElement>(null);

  /*
   * Po otevření se plán sroluje na "teď" - jinak by člověk koukal na ráno,
   * které má za sebou. Jen když stránka stojí nahoře: vrátil-li se hub na
   * uloženou pozici, patří obrazovka jemu.
   */
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      const el = gridRef.current;
      if (!el || window.scrollY > 8) return;
      const px = week ? 0.9 : DAY_PX_PER_MIN;
      const fromMin = Number(el.dataset.fromMin ?? 360);
      const top = el.getBoundingClientRect().top + window.scrollY + (nowMinutes - fromMin) * px - 160;
      // Skokem, ne plynule: obrazovka se má otevřít rovnou na dnešku.
      window.scrollTo(0, Math.max(0, top));
    }, 90);
    return () => window.clearTimeout(id);
    // Schválně jen po otevření: každý tik hodin by scrollem cukal.

  }, []);

  /** Odkud hledat volno: dnes od teď, jindy od rána. */
  const searchFrom = (day: ISODate) => (day === today ? Math.max(8 * 60, nowMinutes) : 8 * 60);

  /**
   * Hození věci do plánu. Blok padne do nejbližšího volna, ne na "teď" - dvě
   * věci naráz v jednom čase jsou skoro vždycky omyl.
   */
  const drop = (input: DropInput, day: ISODate = date) => {
    const start = nextFreeSlot(blocksOfDay(state, day), searchFrom(day), DEFAULT_DURATION);
    const block = addBlock({
      date: day,
      start,
      duration: DEFAULT_DURATION,
      title: input.title,
      todoId: input.todoId ?? null,
      taskId: input.taskId ?? null,
    });
    void tapFeedback();
    toast({
      tone: "info",
      title: `Naplánováno na ${formatMinutes(start)}`,
      description: input.title,
      action: { label: "Upravit", onClick: () => setEditing(block) },
    });
  };

  /** Z čárkované stopy (termín z ToDo) se ťuknutím stane blok na stejný čas. */
  const planPin = (pin: DuePin, day: ISODate) => {
    addBlock({
      date: day,
      start: pin.start,
      duration: pin.duration,
      title: pin.todo.text,
      todoId: pin.todo.id,
    });
    void tapFeedback();
  };

  return (
    <div className="flex flex-col gap-3">
      <Header
        date={date}
        today={today}
        week={week}
        onChange={setDate}
        summary={
          week
            ? weekSummary(days.map((d) => daySummary(state, d)))
            : daySummaryText(blocks.length + pins.length, plannedMinutes(blocks))
        }
      />

      {week ? null : <DayStrip date={date} today={today} onChange={setDate} />}

      <Queue date={date} onDrop={(input) => drop(input)} />

      {week ? (
        <WeekView
          days={days}
          today={today}
          nowMinutes={nowMinutes}
          gridRef={gridRef}
          onPick={(day, start) => setCreating({ date: day, start })}
          onOpen={setEditing}
          onPlanPin={(pin) => planPin(pin, pin.todo.dueDate as ISODate)}
        />
      ) : (
        <DayView
          date={date}
          blocks={blocks}
          pins={pins}
          isToday={isToday}
          nowMinutes={nowMinutes}
          gridRef={gridRef}
          onPick={(start) => setCreating({ date, start })}
          onOpen={setEditing}
          onPlanPin={(pin) => planPin(pin, date)}
        />
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Podrž prst na bloku a posuň ho{week ? " - i na jiný den" : ""}. Za spodní hranu se dá
        natáhnout.
      </p>

      <Fab
        onClick={() =>
          setCreating({
            date,
            start: nextFreeSlot(blocksOfDay(state, date), searchFrom(date), DEFAULT_DURATION),
          })
        }
        aria-label="Nový blok"
      >
        <Plus /> Nový blok
      </Fab>

      {creating ? (
        <BlockDialog date={creating.date} start={creating.start} onClose={() => setCreating(null)} />
      ) : null}
      {editing ? (
        <BlockDialog block={editing} date={editing.date} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

/** Tik pro čáru "teď" - jednou za minutu stačí, plán nejsou stopky. */
function useNow(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function daySummaryText(count: number, minutes: number): string {
  if (count === 0) return "nic naplánovaného";
  return `${count} ${plural(count, "blok", "bloky", "bloků")} · ${formatLength(minutes)}`;
}

function weekSummary(days: { blocks: number; minutes: number; pins: number }[]): string {
  const count = days.reduce((s, d) => s + d.blocks + d.pins, 0);
  const minutes = days.reduce((s, d) => s + d.minutes, 0);
  if (count === 0) return "prázdný týden";
  return `${count} ${plural(count, "blok", "bloky", "bloků")} · ${formatLength(minutes)}`;
}

// --- hlavička ---------------------------------------------------------------

function Header({
  date,
  today,
  week,
  summary,
  onChange,
}: {
  date: ISODate;
  today: ISODate;
  week: boolean;
  summary: string;
  onChange: (date: ISODate) => void;
}) {
  const step = week ? 7 : 1;
  const days = weekDays(date);
  const label = week
    ? weekLabel(days)
    : date === today
      ? "dnes"
      : date === addDays(today, 1)
        ? "zítra"
        : date === addDays(today, -1)
          ? "včera"
          : `${DAY_SHORT[fromISODate(date).getDay()]} ${formatDate(date)}`;

  const home = week ? !days.includes(today) : date !== today;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={week ? "Předchozí týden" : "Předchozí den"}
        onClick={() => onChange(addDays(date, -step))}
      >
        <ChevronLeft />
      </Button>

      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-sm font-medium first-letter:uppercase">{label}</p>
        <p className="tabular text-xs text-muted-foreground">{summary}</p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label={week ? "Další týden" : "Další den"}
        onClick={() => onChange(addDays(date, step))}
      >
        <ChevronRight />
      </Button>

      {home ? (
        <Button variant="outline" size="sm" onClick={() => onChange(today)}>
          <CalendarDays /> Dnes
        </Button>
      ) : null}
    </div>
  );
}

/** "25. - 31. srpna" nebo "29. 8. - 4. 9." přes přelom měsíce. */
function weekLabel(days: ISODate[]): string {
  const first = days[0];
  const last = days[6];
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return sameMonth
    ? `${dayOfMonth(first)}. - ${dayOfMonth(last)}. ${monthGenitive(first)}`
    : `${formatDate(first).replace(/ \d{4}$/, "")} - ${formatDate(last).replace(/ \d{4}$/, "")}`;
}

/**
 * Pruh sedmi dnů. Je to zároveň přehled („kde je nabito") i navigace -
 * v ose dne se bez něj skáče po jednom dni šipkami a týden se z toho nedá
 * přečíst.
 */
function DayStrip({
  date,
  today,
  onChange,
}: {
  date: ISODate;
  today: ISODate;
  onChange: (date: ISODate) => void;
}) {
  const { state } = useStore();
  const days = weekDays(date);

  return (
    <div className="flex gap-1">
      {days.map((day) => {
        const summary = daySummary(state, day);
        const active = day === date;
        const load = Math.min(3, summary.blocks + summary.pins);

        return (
          <button
            key={day}
            type="button"
            onClick={() => onChange(day)}
            aria-pressed={active}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg border py-1.5 transition-colors",
              active
                ? "border-foreground/40 bg-accent"
                : "border-transparent hover:bg-accent/50",
            )}
          >
            <span className="text-[10px] uppercase leading-none text-muted-foreground">
              {DAY_SHORT[fromISODate(day).getDay()]}
            </span>
            <span
              className={cn(
                "tabular grid size-6 place-items-center rounded-full text-[12px] leading-none",
                day === today ? "bg-foreground font-semibold text-background" : "font-medium",
              )}
            >
              {dayOfMonth(day)}
            </span>
            <span className="flex h-1 items-center gap-0.5">
              {Array.from({ length: load }, (_, i) => (
                <span key={i} className="size-1 rounded-full bg-muted-foreground/50" />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
