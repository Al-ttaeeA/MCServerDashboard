"use client";

import Link from "next/link";
import { statById, type LeaderboardsResponse } from "@smp/core";
import { useApi } from "@/lib/api";
import { formatStatValue } from "@/lib/format";
import { Icon } from "@/components/ui/Icon";
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";

export default function LeaderboardsPage() {
  const res = useApi<LeaderboardsResponse>("/leaderboards");

  return (
    <div className="flex flex-col gap-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leaderboards</h1>
        <p className="mt-1 text-sm text-ink-2">Every stat the logs can tell us, ranked.</p>
      </div>
      {res.status === "error" && !res.data ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : res.data.leaderboards.every((b) => b.entries.length === 0) ? (
        <EmptyState icon="trophy" title="Nothing to rank yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {res.data.leaderboards.map((board) => {
            const def = statById(board.statId);
            const max = Math.max(...board.entries.map((e) => e.value), 0) || 1;
            return (
              <Card key={board.statId} className="p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  {def ? <Icon name={def.icon} className="size-4 text-ink-3" /> : null}
                  {board.label}
                </h2>
                <ol className="space-y-2">
                  {board.entries.slice(0, 8).map((e, i) => (
                    <li key={e.player.id}>
                      <Link href={`/player/?name=${encodeURIComponent(e.player.name)}`} className="group flex items-center gap-2.5 text-sm">
                        <span className="w-4 text-right text-xs tabular text-ink-3">{i + 1}</span>
                        <Avatar uuid={e.player.uuid} name={e.player.name} color={e.player.color} size={20} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate group-hover:underline">{e.player.name}</span>
                            <span className="tabular font-medium">{formatStatValue(e.value, board.unit)}</span>
                          </span>
                          <span className="mt-1 block h-1 rounded-full bg-grid">
                            <span className="block h-full rounded-full" style={{ width: `${(e.value / max) * 100}%`, background: e.player.color }} />
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
