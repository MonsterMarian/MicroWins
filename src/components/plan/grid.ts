"use client";

import * as React from "react";
import { blockEnd, type DuePin } from "@/lib/timeblocks";
import type { TimeBlock } from "@/lib/types";

/**
 * Společné počty pro obě mřížky plánu.
 */

/** Kdy mřížka začíná a končí, když do ní nic nezasahuje. */
const DEFAULT_FROM_HOUR = 6;
const DEFAULT_TO_HOUR = 23;

/** O kolik hodin povyroste po ťuknutí na šipku u kraje. */
const EXTEND_HOURS = 3;

/**
 * Termín z ToDo se v mřížce počítá jako blok - jinak by se s bloky překrýval
 * a překrývající se věci si mají stoupnout vedle sebe. Předpona v `id` je
 * jediné, čím se pak od skutečného bloku pozná.
 */
export const PIN_PREFIX = "pin:";

export function pinBlock(pin: DuePin): TimeBlock {
  return {
    id: `${PIN_PREFIX}${pin.todo.id}`,
    date: pin.todo.dueDate as string,
    start: pin.start,
    duration: pin.duration,
    title: pin.todo.text,
    todoId: pin.todo.id,
    taskId: null,
    createdAt: pin.todo.createdAt,
    doneAt: null,
  };
}

export interface GridRange {
  fromHour: number;
  toHour: number;
  fromMin: number;
  extendEarly: () => void;
  extendLate: () => void;
}

/**
 * Rozsah hodin, který se kreslí.
 *
 * Drží pevné rozmezí, dokud do něj něco nezasahuje: mřížka, která se
 * překresluje podle obsahu, by pod rukama pokaždé jinak skákala. Ranní nebo
 * noční blok si ji roztáhne sám, zbytek si uživatel dovolá šipkami u kraje.
 */
export function useGridRange(blocks: TimeBlock[], pins: DuePin[], resetKey?: string): GridRange {
  const [extra, setExtra] = React.useState({ early: 0, late: 0 });
  React.useEffect(() => setExtra({ early: 0, late: 0 }), [resetKey]);

  const starts = [...blocks.map((b) => b.start), ...pins.map((p) => p.start)];
  const ends = [...blocks.map(blockEnd), ...pins.map((p) => p.start + p.duration)];

  const fromHour = Math.max(
    0,
    Math.min(DEFAULT_FROM_HOUR - extra.early, ...starts.map((s) => Math.floor(s / 60))),
  );
  const toHour = Math.min(
    24,
    Math.max(DEFAULT_TO_HOUR + extra.late, ...ends.map((e) => Math.ceil(e / 60))),
  );

  return {
    fromHour,
    toHour,
    fromMin: fromHour * 60,
    extendEarly: () => setExtra((e) => ({ ...e, early: e.early + EXTEND_HOURS })),
    extendLate: () => setExtra((e) => ({ ...e, late: e.late + EXTEND_HOURS })),
  };
}
