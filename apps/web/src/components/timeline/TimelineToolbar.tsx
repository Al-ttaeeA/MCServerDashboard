"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerRefDto } from "@smp/core";
import { Icon } from "@/components/ui/Icon";
import { PlayerSwatch } from "@/components/ui/primitives";

export type RangePreset = "24h" | "7d" | "30d" | "all";

export const PRESETS: { id: RangePreset; label: string; ms: number | null }[] = [
  { id: "24h", label: "24h", ms: 86_400_000 },
  { id: "7d", label: "7d", ms: 7 * 86_400_000 },
  { id: "30d", label: "30d", ms: 30 * 86_400_000 },
  { id: "all", label: "All", ms: null },
];

/** One row of filters above the timeline: range presets, custom dates, players, reset, table. */
export function TimelineToolbar({
  activePreset,
  onPreset,
  onCustomRange,
  players,
  hidden,
  onToggle,
  onShowAll,
  showTable,
  onToggleTable,
}: {
  activePreset: RangePreset | null;
  onPreset: (p: RangePreset) => void;
  onCustomRange: (from: Date, to: Date) => void;
  players: PlayerRefDto[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
  showTable: boolean;
  onToggleTable: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Time range" className="flex rounded-lg border border-line bg-panel p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={activePreset === p.id}
            onClick={() => onPreset(p.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activePreset === p.id ? "bg-raised text-ink shadow-sm" : "text-ink-2 hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <CustomRange onApply={onCustomRange} />
      <PlayerFilter players={players} hidden={hidden} onToggle={onToggle} onShowAll={onShowAll} />
      <button
        type="button"
        onClick={() => onPreset("all")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <Icon name="reset" className="size-3.5" /> Reset zoom
      </button>
      <button
        type="button"
        aria-pressed={showTable}
        onClick={onToggleTable}
        className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
          showTable ? "border-ink-3 bg-raised text-ink" : "border-line bg-panel text-ink-2 hover:text-ink"
        }`}
      >
        <Icon name="table" className="size-3.5" /> Table
      </button>
    </div>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const toInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function CustomRange({ onApply }: { onApply: (from: Date, to: Date) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => toInput(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => toInput(new Date()));
  const ref = useDismiss(open, () => setOpen(false));
  const valid = from && to && from <= to;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <Icon name="calendar" className="size-3.5" /> Dates
      </button>
      {open ? (
        <form
          className="pop-in absolute left-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-line bg-raised p-3 shadow-[var(--shadow-pop)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            const [fy, fm, fd] = from.split("-").map(Number);
            const [ty, tm, td] = to.split("-").map(Number);
            onApply(new Date(fy!, fm! - 1, fd!), new Date(ty!, tm! - 1, td! + 1));
            setOpen(false);
          }}
        >
          <label className="block text-xs text-ink-3">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink [color-scheme:dark]" />
          </label>
          <label className="mt-2 block text-xs text-ink-3">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink [color-scheme:dark]" />
          </label>
          <button type="submit" disabled={!valid} className="mt-3 w-full rounded-md bg-ink py-1.5 text-sm font-medium text-bg disabled:opacity-40">
            Apply
          </button>
        </form>
      ) : null}
    </div>
  );
}

function PlayerFilter({
  players,
  hidden,
  onToggle,
  onShowAll,
}: {
  players: PlayerRefDto[];
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const visible = players.length - hidden.size;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <Icon name="users" className="size-3.5" />
        Players
        <span className="rounded bg-raised px-1 tabular text-ink-3">{hidden.size ? `${visible}/${players.length}` : "All"}</span>
      </button>
      {open ? (
        <div className="pop-in absolute left-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-line bg-raised p-1.5 shadow-[var(--shadow-pop)]">
          <button type="button" onClick={onShowAll} className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-ink-2 hover:bg-panel hover:text-ink">
            Show all players
          </button>
          <div className="my-1 h-px bg-line-soft" />
          <ul className="max-h-72 overflow-auto">
            {players.map((p) => {
              const checked = !hidden.has(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-panel">
                    <input type="checkbox" checked={checked} onChange={() => onToggle(p.id)} className="sr-only" />
                    <span className={`flex size-4 items-center justify-center rounded border ${checked ? "border-transparent bg-ink text-bg" : "border-line"}`} aria-hidden>
                      {checked ? <Icon name="check" className="size-3" /> : null}
                    </span>
                    <PlayerSwatch color={p.color} />
                    <span className="truncate">{p.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
