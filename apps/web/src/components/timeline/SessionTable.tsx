import { visibleSessions, type TimelineRow } from "@/lib/timeline/model";
import type { Viewport } from "@/lib/timeline/viewport";
import { formatDateTime, formatDuration } from "@/lib/format";
import { PlayerSwatch } from "@/components/ui/primitives";

/** Accessible table alternative to the canvas: every session in the current view. */
export function SessionTable({ rows, viewport }: { rows: TimelineRow[]; viewport: Viewport }) {
  const sessions = rows
    .flatMap((r) => visibleSessions(r.sessions, viewport.start, viewport.end).map((s) => ({ player: r.player, s })))
    .sort((a, b) => b.s.start - a.s.start);
  if (sessions.length === 0) return <p className="px-4 py-6 text-sm text-ink-3">No sessions in this time range.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Sessions in the visible time range</caption>
        <thead className="sticky top-0 bg-panel text-left text-xs text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Player</th>
            <th scope="col" className="px-4 py-2 font-medium">Joined</th>
            <th scope="col" className="px-4 py-2 font-medium">Left</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {sessions.slice(0, 500).map(({ player, s }) => (
            <tr key={`${player.id}-${s.start}`} className="border-t border-line-soft">
              <td className="px-4 py-1.5">
                <span className="flex items-center gap-2">
                  <PlayerSwatch color={player.color} />
                  {player.name}
                </span>
              </td>
              <td className="px-4 py-1.5 text-ink-2">{formatDateTime(s.start)}</td>
              <td className="px-4 py-1.5 text-ink-2">
                {s.live ? "Online now" : formatDateTime(s.end)}
                {s.estimated ? <span className="ml-1 text-ink-3" title="Estimated end time">≈</span> : null}
              </td>
              <td className="px-4 py-1.5 text-right">{formatDuration(s.duration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length > 500 ? <p className="px-4 py-2 text-xs text-ink-3">Showing the 500 most recent of {sessions.length} sessions. Zoom in to narrow the range.</p> : null}
    </div>
  );
}
