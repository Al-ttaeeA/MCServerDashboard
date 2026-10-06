"use client";

import { useState } from "react";
import type { SessionDto, SessionsResponse } from "@smp/core";
import { apiGet, useApi } from "@/lib/api";
import { formatDuration, formatTime, formatWeekdayDate } from "@/lib/format";
import { Card, ErrorState, Skeleton } from "@/components/ui/primitives";

const END_LABEL: Record<SessionDto["endReason"], string> = {
  leave: "Left",
  server_stop: "Server stopped",
  crash: "Server crashed (estimated)",
  inferred_empty: "Leave not logged (estimated)",
  rejoin: "Reconnected",
  open: "Online now",
};

/** Paginated session history, newest first. */
export function SessionHistory({ playerName }: { playerName: string }) {
  const first = useApi<SessionsResponse>(`/players/${encodeURIComponent(playerName)}/sessions?limit=15`);
  const [more, setMore] = useState<{ sessions: SessionDto[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  if (first.status === "error" && !first.data) return <ErrorState error={first.error} onRetry={first.reload} />;
  if (!first.data) return <Skeleton className="h-64 w-full" />;

  const sessions = [...first.data.sessions, ...(more?.sessions ?? [])];
  const cursor = more ? more.cursor : first.data.nextCursor;

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<SessionsResponse>(`/players/${encodeURIComponent(playerName)}/sessions?limit=30&before=${encodeURIComponent(cursor)}`);
      setMore((m) => ({ sessions: [...(m?.sessions ?? []), ...page.sessions], cursor: page.nextCursor }));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Session history</caption>
          <thead className="bg-panel text-left text-xs text-ink-3">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Date</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Time</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Duration</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Ended</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.start} className="border-t border-line-soft">
                <td className="px-4 py-2">{formatWeekdayDate(s.start)}</td>
                <td className="tabular px-4 py-2 text-ink-2">
                  {formatTime(s.start)} – {s.endReason === "open" ? "now" : formatTime(s.end)}
                </td>
                <td className="tabular px-4 py-2 text-right font-medium">{formatDuration(s.duration)}</td>
                <td className={`px-4 py-2 text-xs ${s.estimated ? "text-ink-3" : "text-ink-2"}`}>{END_LABEL[s.endReason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor ? (
        <div className="border-t border-line-soft p-2 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load older sessions"}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
