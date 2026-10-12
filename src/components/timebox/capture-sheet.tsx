"use client";

import * as React from "react";
import { CornerDownLeft } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useStore } from "@/components/providers/store-provider";
import { tapFeedback } from "@/lib/native";
import { formatMinutes } from "@/lib/timeblocks";
import { parseDumpTime, SHEET_SLOT, sheetOf } from "@/lib/timebox";
import type { ISODate } from "@/lib/types";

/**
 * Rychlý zápis do brain dumpu odkudkoli z listu.
 *
 * Brain dump je na telefonu pod celou mřížkou, takže „rychle si to zapsat"
 * znamenalo sjet o dvě obrazovky. Tady se píše řádek po řádku: Enter ho
 * uloží a pole zůstane připravené na další. Čas na začátku („14:30 běh")
 * ho posadí rovnou do mřížky, stejně jako v samotném dumpu.
 */
export function CaptureSheet({
  open,
  date,
  onClose,
}: {
  open: boolean;
  date: ISODate;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Do brain dumpu"
      description="Enter uloží řádek. Čas na začátku („14:30 běh“) ho posadí rovnou do mřížky."
    >
      {open ? <CaptureBody date={date} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

interface Captured {
  id: number;
  text: string;
  start: number | null;
}

function CaptureBody({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const { state, setBrainDump, addBlock } = useStore();
  const [draft, setDraft] = React.useState("");
  const [added, setAdded] = React.useState<Captured[]>([]);
  const input = React.useRef<HTMLInputElement | null>(null);
  /* Dva řádky rychle po sobě nesmí číst stejný starý dump - druhý by přepsal
     první. Proto se drží poslední zapsaný text, ne jen stav z renderu. */
  const dump = React.useRef(sheetOf(state, date).brainDump);
  dump.current = sheetOf(state, date).brainDump;

  const save = () => {
    const line = draft.trim();
    if (!line) return;
    const timed = parseDumpTime(line);
    if (timed) {
      addBlock({ date, start: timed.start, duration: SHEET_SLOT, title: timed.title });
    } else {
      const current = dump.current.replace(/\s+$/, "");
      const next = current === "" ? line : `${current}\n${line}`;
      dump.current = next;
      setBrainDump(date, next);
    }
    void tapFeedback();
    setAdded((prev) => [{ id: prev.length, text: timed ? timed.title : line, start: timed?.start ?? null }, ...prev]);
    setDraft("");
    input.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3 pb-1">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          ref={input}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          enterKeyHint="enter"
          aria-label="Nový řádek brain dumpu"
          placeholder="Co se honí hlavou"
          className="h-12 min-w-0 flex-1 rounded-xl border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          aria-label="Uložit řádek"
          disabled={draft.trim() === ""}
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-foreground text-background disabled:opacity-40 [&_svg]:size-5"
        >
          <CornerDownLeft />
        </button>
      </form>

      {added.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {added.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{item.text}</span>
              <span className="tabular shrink-0 text-xs text-muted-foreground">
                {item.start === null ? "v dumpu" : `v mřížce ${formatMinutes(item.start)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className="h-11 rounded-xl border text-sm font-medium hover:bg-accent"
      >
        Hotovo
      </button>
    </div>
  );
}
