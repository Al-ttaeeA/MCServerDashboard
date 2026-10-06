"use client";

import { useCallback, useMemo, useState } from "react";
import type { MetaResponse, PlayerRefDto, PlayersResponse, TimelineResponse } from "@smp/core";
import { useApi } from "@/lib/api";
import { useNow } from "@/lib/use-now";
import { formatBucketDate, formatDateTime, formatDuration, formatNumber, formatRange } from "@/lib/format";
import { buildRows, totalInRange } from "@/lib/timeline/model";
import { boundsFor, clampViewport, span, type Viewport } from "@/lib/timeline/viewport";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { ActivityTimeline } from "./ActivityTimeline";
import { PlayerPopover } from "./PlayerPopover";
import { SessionTable } from "./SessionTable";
import { PRESETS, TimelineToolbar, type RangePreset } from "./TimelineToolbar";

const HIDDEN_KEY = "smp.timeline.hidden";
/** If the last sync is this recent, still-open sessions are drawn up to "now". */
const LIVE_WINDOW_MS = 75 * 60_000;

export function TimelineView() {
  const timeline = useApi<TimelineResponse>("/timeline");
  const players = useApi<PlayersResponse>("/players");
  const meta = useApi<MetaResponse>("/meta");

  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [userViewport, setViewport] = useState<Viewport | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [popover, setPopover] = useState<{ player: PlayerRefDto; anchor: { x: number; y: number } } | null>(null);

  const updateHidden = (next: Set<string>) => {
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable */
    }
  };

  const now = useNow();
  const data = timeline.data;
  const lastSync = meta.data?.lastSuccessfulSyncAt ? Date.parse(meta.data.lastSuccessfulSyncAt) : null;
  const liveUntil = now > 0 && lastSync !== null && now - lastSync < LIVE_WINDOW_MS ? now : null;
  const onlineIds = useMemo(() => new Set(meta.data?.onlinePlayerIds ?? []), [meta.data]);

  const allRows = useMemo(() => (data ? buildRows(data.players, data.sessions, liveUntil) : []), [data, liveUntil]);
  const rows = useMemo(() => allRows.filter((r) => !hidden.has(r.player.id)), [allRows, hidden]);
  const extent = useMemo(() => {
    if (!data?.extent) return null;
    return { start: Date.parse(data.extent.start), end: Math.max(Date.parse(data.extent.end), liveUntil ?? 0) };
  }, [data, liveUntil]);
  const bounds = useMemo(() => (extent ? boundsFor(extent.start, Math.max(extent.end, now)) : null), [extent, now]);

  const presetViewport = useCallback(
    (p: RangePreset): Viewport | null => {
      if (!bounds) return null;
      const preset = PRESETS.find((x) => x.id === p)!;
      const end = Math.min(bounds.max, now + 30 * 60_000);
      return clampViewport(preset.ms ? { start: end - preset.ms, end } : { start: bounds.min, end: bounds.max }, bounds);
    },
    [bounds, now],
  );
  const applyPreset = (p: RangePreset) => setViewport(presetViewport(p));

  // Until the user zooms/pans: the last 7 days, or everything if there's less history than that.
  const viewport =
    userViewport ?? (bounds ? presetViewport(bounds.max - bounds.min > 7 * 86_400_000 ? "7d" : "all") : null);

  const activePreset = useMemo<RangePreset | null>(() => {
    if (!viewport || !bounds) return null;
    if (span(viewport) >= bounds.max - bounds.min - 1000) return "all";
    const match = PRESETS.find((p) => p.ms && Math.abs(span(viewport) - p.ms) < 60_000 && bounds.max - viewport.end < 31 * 60_000);
    return match?.id ?? null;
  }, [viewport, bounds]);

  const summaries = useMemo(() => new Map(players.data?.players.map((p) => [p.id, p]) ?? []), [players.data]);
  const popoverPlayer = popover ? summaries.get(popover.player.id) : undefined;
  const closePopover = useCallback(() => setPopover(null), []);

  if (timeline.status === "error" && !data) return <ErrorState error={timeline.error} onRetry={timeline.reload} />;

  const inView = viewport ? rows.reduce((sum, r) => sum + totalInRange(r.sessions, viewport.start, viewport.end), 0) : 0;
  const server = meta.data?.server;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Server activity</h1>
          <p className="mt-1 text-sm text-ink-2">
            {viewport ? (
              <>
                {formatRange(viewport.start, viewport.end)}
                {inView > 0 ? <span className="text-ink-3"> · {formatDuration(inView)} played in view</span> : null}
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        {onlineIds.size > 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <span className="live-dot size-2 rounded-full bg-good" aria-hidden />
            {onlineIds.size} {onlineIds.size === 1 ? "player" : "players"} online now
          </p>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-line-soft p-3">
          <TimelineToolbar
            activePreset={activePreset}
            onPreset={applyPreset}
            onCustomRange={(from, to) => bounds && setViewport(clampViewport({ start: from.getTime(), end: to.getTime() }, bounds))}
            players={data?.players ?? []}
            hidden={hidden}
            onToggle={(id) => {
              const next = new Set(hidden);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              updateHidden(next);
            }}
            onShowAll={() => updateHidden(new Set())}
            showTable={showTable}
            onToggleTable={() => setShowTable((s) => !s)}
          />
        </div>

        {!data || !viewport || !extent ? (
          data && !data.extent ? (
            <EmptyState icon="clock" title="No sessions yet">
              Once the log sync has imported some play sessions, they&apos;ll show up here.
            </EmptyState>
          ) : (
            <TimelineSkeleton />
          )
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="All players are hidden">
            Use the Players filter to choose who to show.
          </EmptyState>
        ) : (
          <div>
            <ActivityTimeline
              rows={rows}
              extent={extent}
              viewport={viewport}
              onViewportChange={setViewport}
              onlineIds={onlineIds}
              onSelectPlayer={(player, anchor) => setPopover({ player, anchor })}
              suppressHover={popover !== null}
              ariaLabel="Player activity timeline"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-4 py-2 text-[11px] text-ink-3">
          <span className="hidden sm:inline">Scroll to zoom · drag or Shift+scroll to pan · click a row for player stats</span>
          <span className="sm:hidden">Drag to pan · pinch to zoom · tap a row for stats</span>
          <span className="ml-auto hidden items-center gap-3 md:flex">
            <Legend swatch="bar" label="Online" />
            <Legend swatch="fade" label="Estimated end" />
            <Legend swatch="rail" label="Offline" />
          </span>
        </div>

        {showTable && viewport ? (
          <div className="border-t border-line-soft">
            <SessionTable rows={rows} viewport={viewport} />
          </div>
        ) : null}
      </Card>

      {server && server.sessionCount > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat label="Players" value={formatNumber(server.playerCount)} />
          <MiniStat label="Total playtime" value={formatDuration(server.totalPlaytimeSeconds)} />
          <MiniStat
            label="Peak online"
            value={server.peakConcurrent ? `${server.peakConcurrent.count} players` : "—"}
            detail={server.peakConcurrent ? formatDateTime(server.peakConcurrent.at) : undefined}
          />
          <MiniStat
            label="Busiest day"
            value={server.busiestDay ? formatBucketDate(server.busiestDay.date, { weekday: "short", month: "short", day: "numeric" }) : "—"}
            detail={server.busiestDay ? `${formatDuration(server.busiestDay.seconds)} played` : undefined}
          />
        </div>
      ) : null}

      {popover && popoverPlayer ? <PlayerPopover player={popoverPlayer} anchor={popover.anchor} onClose={closePopover} /> : null}
    </div>
  );
}

function loadHidden(): Set<string> {
  // Per-browser convenience only; safe to lose.
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line-soft bg-panel/50 px-4 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
      {detail ? <div className="text-xs text-ink-3">{detail}</div> : null}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: "bar" | "fade" | "rail"; label: string }) {
  const style =
    swatch === "bar"
      ? { background: "#a4abb8", boxShadow: "0 0 6px rgba(164,171,184,.6)" }
      : swatch === "fade"
        ? { background: "linear-gradient(90deg, #a4abb8 40%, rgba(164,171,184,.12))" }
        : { background: "rgba(164,171,184,.25)", height: 2 };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-4 rounded-[2px]" style={style} aria-hidden />
      {label}
    </span>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy aria-label="Loading timeline">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  );
}
