"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { AwardsResponse } from "@smp/core";
import { useApi } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { ordinal } from "@/components/awards/AwardBadge";
import { RecordInfo } from "@/components/awards/RecordInfo";
import { Avatar, Card, EmptyState, ErrorState, Section, Skeleton } from "@/components/ui/primitives";

function AwardsPage() {
  const params = useSearchParams();
  const debug = params.get("debug") === "1";
  const playerFilter = params.get("player")?.toLowerCase() ?? null;
  const res = useApi<AwardsResponse>(debug ? "/awards?debug=1" : "/awards");

  if (res.status === "error" && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const data = res.data;

  return (
    <div className="flex flex-col gap-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Server awards</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Each award goes to exactly one player — whoever stands out most. Everyone gets up to three, chosen so the whole server&apos;s awards are as remarkable as possible.
          </p>
        </div>
        {data?.computedAt ? <span className="text-xs text-ink-3">Updated {formatRelative(data.computedAt)}</span> : null}
      </div>

      {!data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : data.awards.length === 0 ? (
        <EmptyState icon="trophy" title="No awards yet">
          Awards appear once there&apos;s enough data to compare players.
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.awards.map((a) => (
            <Card key={a.metricId} className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden>
                  {a.emoji}
                </span>
                <h2 className="text-xs font-bold uppercase tracking-[0.1em]">{a.title}</h2>
              </div>
              <Link href={`/player/?name=${encodeURIComponent(a.player.name)}`} className="flex items-center gap-2 font-semibold hover:underline">
                <Avatar uuid={a.player.uuid} name={a.player.name} color={a.player.color} size={22} />
                {a.player.name}
              </Link>
              <p className="text-sm text-ink-2">{a.explanation}</p>
            </Card>
          ))}
        </div>
      )}

      {data && data.records.length ? (
        <Section title="Records" description="The #1 for every statistic, whether or not it became their award.">
          <Card className="overflow-hidden">
            <ul className="grid divide-y divide-line-soft sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
              {data.records.map((r) => (
                <li key={`${r.metricId}:${r.direction}`} className="flex items-center gap-3 border-line-soft px-4 py-2.5 sm:border-b">
                  <span className="text-lg" aria-hidden>
                    {r.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-xs text-ink-3">
                      <span className="truncate">{r.title}</span>
                      <RecordInfo record={r} />
                    </span>
                    <span className="flex items-center gap-1.5 text-sm">
                      <Avatar uuid={r.player.uuid} name={r.player.name} color={r.player.color} size={16} />
                      <span className="truncate">{r.player.name}</span>
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium">{r.formatted}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      {debug && data?.debug ? <DebugView data={data} playerFilter={playerFilter} /> : null}
      {!debug ? (
        <p className="text-xs text-ink-3">
          Curious how it works? <Link href="/awards/?debug=1" className="underline hover:text-ink">Open the scoring breakdown</Link>.
        </p>
      ) : null}
    </div>
  );
}

/** Developer view: every candidate and every metric's eligibility, with the numbers behind each score. */
function DebugView({ data, playerFilter }: { data: AwardsResponse; playerFilter: string | null }) {
  const debug = data.debug!;
  const titles = useMemo(() => new Map(data.metrics.flatMap((m) => [[`${m.id}:high`, m.high?.title], [`${m.id}:low`, m.low?.title]])), [data.metrics]);
  const metricInfo = useMemo(() => new Map(data.metrics.map((m) => [m.id, m])), [data.metrics]);
  const candidates = debug.candidates.filter((c) => !playerFilter || c.player.name.toLowerCase() === playerFilter);
  const n = (x: number, d = 2) => x.toFixed(d);

  return (
    <Section
      title="Scoring breakdown"
      description={
        <>
          score = extremeness × rarity × confidence × population × reliability. Only the #1 player per metric and direction is a candidate; allocation then picks the best set overall.{" "}
          {playerFilter ? (
            <Link href="/awards/?debug=1" className="underline">
              Show all players
            </Link>
          ) : null}
        </>
      }
    >
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-xs">
          <caption className="sr-only">Award candidates</caption>
          <thead className="bg-panel text-left text-ink-3">
            <tr>
              {["", "Award", "Player", "Value", "Pctl", "Median", "z", "Extreme", "Rarity", "Confid.", "Pop.", "Reliab.", "Score"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {candidates.map((c) => (
              <tr key={`${c.metricId}:${c.direction}`} className={`border-t border-line-soft ${c.won ? "" : "text-ink-3"}`}>
                <td className="px-3 py-1.5">{c.won ? "🏆" : ""}</td>
                <td className="px-3 py-1.5">
                  {titles.get(`${c.metricId}:${c.direction}`)} <span className="text-ink-3">({c.metricId})</span>
                </td>
                <td className="px-3 py-1.5">{c.player.name}</td>
                <td className="px-3 py-1.5">{n(c.value)}</td>
                <td className="px-3 py-1.5">{ordinal(c.percentile)}</td>
                <td className="px-3 py-1.5">{n(c.median)}</td>
                <td className="px-3 py-1.5">{n(c.z)}</td>
                <td className="px-3 py-1.5">{n(c.extremeness)}</td>
                <td className="px-3 py-1.5">{n(c.rarity)}</td>
                <td className="px-3 py-1.5">{n(c.confidence)}</td>
                <td className="px-3 py-1.5">{n(c.populationFactor)}</td>
                <td className="px-3 py-1.5">{n(c.reliability)}</td>
                <td className="px-3 py-1.5 font-semibold text-ink">{n(c.score, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h3 className="mb-2 mt-6 text-sm font-semibold">Metrics without a candidate</h3>
      <Card className="divide-y divide-line-soft">
        {debug.diagnostics
          .filter((d) => d.note)
          .map((d) => (
            <details key={d.metricId} className="px-4 py-2 text-xs">
              <summary className="cursor-pointer">
                <span className="font-medium">{d.metricId}</span> <span className="text-ink-3">— {d.note}</span>
              </summary>
              <p className="mt-1 text-ink-3">
                {metricInfo.get(d.metricId)?.source} · {metricInfo.get(d.metricId)?.formula}
              </p>
              <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {d.rows.map((r) => (
                  <li key={r.playerKey} className="flex justify-between gap-2">
                    <span>{r.player?.name ?? r.playerKey}</span>
                    <span className="tabular text-ink-3">{r.eligible ? (r.value ?? 0).toFixed(2) : `not eligible (${r.reason})`}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
      </Card>
    </Section>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AwardsPage />
    </Suspense>
  );
}
