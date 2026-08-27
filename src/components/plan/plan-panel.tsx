"use client";

import * as React from "react";
import { Menu, CalendarDays, ChevronLeft, ChevronRight, Plus, Search, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Fab } from "@/components/ui/fab";
import { useStore } from "@/components/providers/store-provider";
import { usePrefs } from "@/components/providers/use-prefs";
import { useToast } from "@/components/providers/toast-provider";
import { addDays, dayOfMonth, DAY_SHORT, formatDate, fromISODate, monthGenitive, monthLabel } from "@/lib/date";
import { tapFeedback } from "@/lib/native";
import {
  blocksOfDay,
  clampStart,
  DEFAULT_DURATION,
  formatLength,
  formatMinutes,
  nextFreeSlot,
  pinsOfDay,
  plannedMinutes,
  type DuePin,
} from "@/lib/timeblocks";
import type { ISODate, TimeBlock } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { BlockDialog } from "./block-dialog";
import { DayView } from "./day-view";
import { Queue, type DropInput } from "./queue";
import { WeekView } from "./week-view";
import { ScheduleView } from "./schedule-view";
import { ThreeDayView } from "./three-day-view";
import { MonthView } from "./month-view";
import { Dialog } from "@/components/ui/dialog";
import { PLAN_VIEWS, type PlanView, setPrefs } from "@/lib/prefs";

export function PlanPanel() {
  const { state, today, addBlock } = useStore();
  const { plan } = usePrefs();
  const [date, setDate] = React.useState<ISODate>(() => today);
  const [creating, setCreating] = React.useState<{ date: ISODate; start: number } | null>(null);
  const [editing, setEditing] = React.useState<TimeBlock | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { toast } = useToast();

  const gridRef = React.useRef<HTMLDivElement>(null);
  const nowMinutes = useNow().getHours() * 60 + useNow().getMinutes();

  const blocks = blocksOfDay(state, date);
  const pins = pinsOfDay(state, date);
  const isToday = date === today;

  const searchFrom = (day: ISODate) => (day === today ? Math.max(8 * 60, nowMinutes) : 8 * 60);

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

  const setView = (v: PlanView) => {
    setPrefs({ plan: v });
    setDrawerOpen(false);
  };

  const stepDate = (dir: 1 | -1) => {
    let days = 1;
    if (plan === "week" || plan === "schedule") days = 7;
    else if (plan === "3day") days = 3;
    else if (plan === "month") days = 30;
    
    setDate(addDays(date, dir * days));
  };

  const daysOfView = React.useMemo(() => {
    if (plan === "week") {
      return Array.from({ length: 7 }, (_, i) => addDays(date, i - (new Date(fromISODate(date)).getDay() + 6) % 7));
    } else if (plan === "3day") {
      return [date, addDays(date, 1), addDays(date, 2)];
    }
    return [date];
  }, [date, plan]);

  const topLabel = React.useMemo(() => {
    if (plan === "day") {
      return `${DAY_SHORT[fromISODate(date).getDay()]} ${formatDate(date)}`;
    } else if (plan === "week" || plan === "3day") {
      const first = daysOfView[0];
      const last = daysOfView[daysOfView.length - 1];
      const sameMonth = first.slice(0, 7) === last.slice(0, 7);
      return sameMonth
        ? `${dayOfMonth(first)}. - ${dayOfMonth(last)}. ${monthGenitive(first)}`
        : `${formatDate(first).replace(/ \d{4}$/, "")} - ${formatDate(last).replace(/ \d{4}$/, "")}`;
    }
    return monthLabel(date); // month, schedule
  }, [date, plan, daysOfView]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -mx-4 sm:mx-0 bg-background text-foreground relative">
      <TopAppBar 
        label={topLabel}
        onMenu={() => setDrawerOpen(true)} 
        onToday={() => setDate(today)}
        onPrev={() => stepDate(-1)}
        onNext={() => stepDate(1)}
      />

      <div className="flex-1 overflow-auto flex flex-col gap-2 p-2">
        {/* We keep the Queue here as a quick add line at the top */}
        <Queue date={date} onDrop={(input) => drop(input)} />

        {plan === "schedule" ? (
          <ScheduleView 
            date={date} 
            today={today} 
            onPick={(d) => {
              setDate(d);
              setView("day");
            }}
            onOpen={setEditing} 
            onPlanPin={(p) => planPin(p as any, p.todo.dueDate as ISODate)} 
          />
        ) : plan === "3day" ? (
          <ThreeDayView
            date={date}
            today={today}
            nowMinutes={nowMinutes}
            gridRef={gridRef}
            onPick={(d, s) => setCreating({ date: d, start: s })}
            onOpen={setEditing}
            onPlanPin={(p) => planPin(p as any, p.todo.dueDate as ISODate)}
          />
        ) : plan === "week" ? (
          <WeekView
            days={daysOfView}
            today={today}
            nowMinutes={nowMinutes}
            gridRef={gridRef}
            onPick={(d, s) => setCreating({ date: d, start: s })}
            onOpen={setEditing}
            onPlanPin={(p) => planPin(p as any, p.todo.dueDate as ISODate)}
          />
        ) : plan === "month" ? (
          <MonthView 
            date={date} 
            today={today} 
            onPick={(d) => {
              setDate(d);
              setView("day");
            }} 
          />
        ) : (
          <DayView
            date={date}
            blocks={blocks}
            pins={pins as any}
            isToday={isToday}
            nowMinutes={nowMinutes}
            gridRef={gridRef}
            onPick={(start) => setCreating({ date, start })}
            onOpen={setEditing}
            onPlanPin={(p) => planPin(p as any, date)}
          />
        )}
      </div>

      <Fab
        onClick={() =>
          setCreating({
            date,
            start: nextFreeSlot(blocksOfDay(state, date), searchFrom(date), DEFAULT_DURATION),
          })
        }
        aria-label="Nový blok"
        className="absolute bottom-6 right-6 shadow-xl bg-primary text-primary-foreground size-14 rounded-2xl justify-center px-0"
      >
        <Plus className="size-8" />
      </Fab>

      {/* Side Drawer */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen} title="Zobrazení kalendáře">
        <div className="flex flex-col gap-2 mt-4">
          {PLAN_VIEWS.map(v => (
            <Button
              key={v.id}
              variant={plan === v.id ? "default" : "ghost"}
              className="justify-start px-4 h-12 rounded-xl text-base"
              onClick={() => setView(v.id)}
            >
              {v.label}
            </Button>
          ))}
        </div>
      </Dialog>

      {creating ? (
        <BlockDialog date={creating.date} start={creating.start} onClose={() => setCreating(null)} />
      ) : null}
      {editing ? (
        <BlockDialog block={editing} date={editing.date} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function TopAppBar({ 
  label, 
  onMenu, 
  onToday,
  onPrev,
  onNext
}: { 
  label: string; 
  onMenu: () => void; 
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 h-14 border-b bg-background shrink-0">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onMenu}>
          <Menu className="size-6" />
        </Button>
        <div className="text-xl font-medium cursor-pointer hover:bg-accent px-2 py-1 rounded-lg capitalize">
          {label}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onPrev}>
          <ChevronLeft className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onNext}>
          <ChevronRight className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onToday}>
          <CalendarDays className="size-5" />
        </Button>
      </div>
    </div>
  );
}

function useNow(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
