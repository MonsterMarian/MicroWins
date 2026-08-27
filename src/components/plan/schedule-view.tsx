"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { type DuePin, formatMinutes } from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";
import { useStore } from "@/components/providers/store-provider";
import { blocksOfDay, pinsOfDay } from "@/lib/timeblocks";
import { fromISODate, addDays, dayName, dayOfMonth, monthShort } from "@/lib/date";
import type { ISODate } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ScheduleView({
  date,
  today,
  onPick,
  onOpen,
  onPlanPin,
}: {
  date: ISODate;
  today: ISODate;
  onPick: (date: ISODate) => void;
  onOpen: (block: TimeBlock) => void;
  onPlanPin: (pin: DuePin) => void;
}) {
  const { state } = useStore();
  
  // Show next 30 days
  const days = Array.from({ length: 30 }, (_, i) => addDays(date, i));
  
  return (
    <Card className="overflow-hidden flex flex-col p-0 bg-background divide-y">
      {days.map((d) => {
        const blocks = blocksOfDay(state, d);
        const pins = pinsOfDay(state, d);
        const isEmpty = blocks.length === 0 && pins.length === 0;
        
        // Skip empty days unless it's today
        if (isEmpty && d !== today) return null;

        const isToday = d === today;
        const dayLabel = dayName(d).substring(0, 3);
        const dateNum = dayOfMonth(d);

        return (
          <div key={d} className="flex p-4 gap-4 border-b border-border/50">
            <div 
              className="w-12 shrink-0 flex flex-col items-center cursor-pointer hover:bg-accent/50 rounded-lg p-1"
              onClick={() => onPick(d)}
            >
              <span className={cn(
                "text-[10px] font-medium uppercase",
                isToday ? "text-primary" : "text-muted-foreground"
              )}>
                {dayLabel}
              </span>
              <span className={cn(
                "tabular grid size-8 place-items-center rounded-full text-lg",
                isToday ? "bg-primary font-semibold text-primary-foreground" : "text-foreground"
              )}>
                {dateNum}
              </span>
            </div>
            
            <div className="flex-1 flex flex-col gap-2 pt-1">
              {isEmpty && (
                <div className="text-sm text-muted-foreground pt-1 italic">
                  Žádné události
                </div>
              )}
              
              {pins.map(pin => (
                <div 
                  key={`pin-${pin.todo.id}`}
                  onClick={() => onPlanPin(pin)}
                  className="rounded-lg border-2 border-dashed border-primary/40 p-2 cursor-pointer hover:bg-accent/50"
                >
                  <div className="text-xs font-semibold text-primary mb-0.5">
                    {formatMinutes(pin.start)}
                  </div>
                  <div className="text-sm">{pin.todo.text}</div>
                </div>
              ))}

              {blocks.map(block => (
                <div 
                  key={block.id}
                  onClick={() => onOpen(block)}
                  className="rounded-lg bg-primary text-primary-foreground p-2 cursor-pointer shadow-sm"
                >
                  <div className="text-xs font-medium opacity-90 mb-0.5">
                    {formatMinutes(block.start)} - {formatMinutes(block.start + block.duration)}
                  </div>
                  <div className="text-sm font-medium">{block.title}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
