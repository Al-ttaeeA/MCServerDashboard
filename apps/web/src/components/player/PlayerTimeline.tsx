"use client";

import { useMemo, useState } from "react";
import type { PlayerSummaryDto, TimelineResponse } from "@smp/core";
import { useApi } from "@/lib/api";
import { useNow } from "@/lib/use-now";
import { buildRows } from "@/lib/timeline/model";
import { boundsFor, clampViewport, type Viewport } from "@/lib/timeline/viewport";
import { ActivityTimeline } from "@/components/timeline/ActivityTimeline";
import { Card, ErrorState, Skeleton } from "@/components/ui/primitives";

/** The player's own sessions on the same zoomable timeline as the homepage. */
export function PlayerTimeline({ player }: { player: PlayerSummaryDto }) {
  const timeline = useApi<TimelineResponse>(`/timeline?players=${encodeURIComponent(player.id)}`);
  const now = useNow();
  const [userViewport, setViewport] = useState<Viewport | null>(null);

  const data = timeline.data;
  const rows = useMemo(() => (data ? buildRows(data.players, data.sessions, player.online && now > 0 ? now : null) : []), [data, player.online, now]);
  const extent = useMemo(() => {
    const all = rows.flatMap((r) => r.sessions);
    if (all.length === 0) return null;
    return { start: Math.min(...all.map((s) => s.start)), end: Math.max(...all.map((s) => s.end)) };
  }, [rows]);
  const viewport = userViewport ?? (extent ? clampViewport({ start: -Infinity, end: Infinity }, boundsFor(extent.start, extent.end)) : null);

  if (timeline.status === "error" && !data) return <ErrorState error={timeline.error} onRetry={timeline.reload} />;
  return (
    <Card className="overflow-hidden">
      {!viewport || !extent ? (
        <div className="p-4">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <ActivityTimeline
          rows={rows}
          extent={extent}
          viewport={viewport}
          onViewportChange={setViewport}
          showStrip={false}
          compactLabels
          ariaLabel={`${player.name}'s sessions`}
        />
      )}
    </Card>
  );
}
