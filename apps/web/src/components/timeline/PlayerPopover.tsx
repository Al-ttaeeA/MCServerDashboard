"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { statById, type PlayerSummaryDto } from "@smp/core";
import { formatDuration, formatRelative, formatStatValue } from "@/lib/format";
import { placePopover } from "@/lib/popover";
import { Icon } from "@/components/ui/Icon";
import { Avatar, OnlineBadge } from "@/components/ui/primitives";

/** Small player card shown when clicking a timeline row. */
export function PlayerPopover({
  player,
  anchor,
  onClose,
}: {
  player: PlayerSummaryDto;
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(placePopover(anchor, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor, player.id]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll);
    };
  }, [onClose, player.id]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${player.name} summary`}
      className="pop-in fixed z-40 w-72 rounded-xl border border-line bg-raised p-4 shadow-[var(--shadow-pop)]"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <div className="absolute inset-x-0 top-0 h-px rounded-t-xl" style={{ background: `linear-gradient(90deg, transparent, ${player.color}, transparent)` }} />
      <div className="flex items-center gap-3">
        <Avatar uuid={player.uuid} name={player.name} color={player.color} size={40} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{player.name}</div>
          <div className="text-xs text-ink-3">{player.online ? <OnlineBadge /> : `Last seen ${formatRelative(player.lastSeen)}`}</div>
        </div>
        <button type="button" onClick={onClose} className="ml-auto self-start rounded p-1 text-ink-3 hover:bg-panel hover:text-ink" aria-label="Close">
          <Icon name="x" className="size-4" />
        </button>
      </div>

      <div className="mt-4">
        <div className="eyebrow">Playtime</div>
        <div className="text-2xl font-semibold tracking-tight">{formatDuration(player.playtimeSeconds)}</div>
        <div className="text-xs text-ink-3">
          across {player.sessionCount} {player.sessionCount === 1 ? "session" : "sessions"}
        </div>
      </div>

      {player.highlights.length ? (
        <ul className="mt-3 space-y-1.5 border-t border-line-soft pt-3">
          {player.highlights.map((h) => {
            const def = statById(h.statId);
            if (!def) return null;
            return (
              <li key={h.statId} className="flex items-center gap-2.5 text-sm">
                <span className="rounded-md bg-panel p-1 text-ink-2">
                  <Icon name={def.icon} className="size-3.5" />
                </span>
                <span className="font-semibold">{formatStatValue(h.value, def.unit)}</span>
                <span className="text-ink-2">{def.noun}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Link
        href={`/player/?name=${encodeURIComponent(player.name)}`}
        className="mt-4 flex items-center justify-center gap-1.5 rounded-md border border-line bg-panel py-2 text-sm font-medium hover:border-ink-3 hover:bg-bg"
      >
        View all stats <Icon name="arrow-right" className="size-3.5" />
      </Link>
    </div>
  );
}
