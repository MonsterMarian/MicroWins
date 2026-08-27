"use client";

import * as React from "react";
import { type DuePin } from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";
import { addDays } from "@/lib/date";
import type { ISODate } from "@/lib/types";
import { WeekView } from "./week-view";

export function ThreeDayView({
  date,
  today,
  nowMinutes,
  gridRef,
  onPick,
  onOpen,
  onPlanPin,
}: {
  date: ISODate;
  today: ISODate;
  nowMinutes: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onPick: (date: ISODate, start: number) => void;
  onOpen: (block: TimeBlock) => void;
  onPlanPin: (pin: DuePin) => void;
}) {
  const days = [date, addDays(date, 1), addDays(date, 2)];
  
  return (
    <WeekView
      days={days}
      today={today}
      nowMinutes={nowMinutes}
      gridRef={gridRef}
      onPick={onPick}
      onOpen={onOpen}
      onPlanPin={onPlanPin}
    />
  );
}
