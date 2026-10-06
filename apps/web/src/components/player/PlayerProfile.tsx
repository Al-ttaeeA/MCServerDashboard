"use client";

import Link from "next/link";
import { useMemo } from "react";
import { isoDateInZone, statById, statNoun, type DeathCategory, type PlayerDetailResponse } from "@smp/core";
import { useApi } from "@/lib/api";
import { useNow } from "@/lib/use-now";
import {
  formatBucketDate,
  formatDate,
  formatDateTime,
  formatDuration,
  formatDurationCompact,
  formatHour,
  formatNumber,
  formatPercent,
  formatRelative,
  formatStatValue,
} from "@/lib/format";
import { BarList } from "@/components/charts/BarList";
import { CalendarHeatmap } from "@/components/charts/CalendarHeatmap";
import { ColumnChart } from "@/components/charts/ColumnChart";
import { Icon } from "@/components/ui/Icon";
import { Avatar, Card, EmptyState, ErrorState, OnlineBadge, ProvenanceTag, Section, Skeleton, StatTile } from "@/components/ui/primitives";
import { PlayerTimeline } from "./PlayerTimeline";
import { SessionHistory } from "./SessionHistory";

const CATEGORY_LABEL: Record<DeathCategory, string> = {
  mob: "Mobs",
  player: "Players",
  fall: "Falling",
  fire: "Fire",
  lava: "Lava",
  drowning: "Drowning",
  explosion: "Explosions",
  suffocation: "Suffocation",
  starvation: "Starvation",
  freezing: "Freezing",
  magic: "Magic",
  void: "The void",
  projectile: "Projectiles",
  environment: "Environment",
  other: "Other",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NAV = [
  ["overview", "Overview"],
  ["activity", "Activity"],
  ["timeline", "Timeline"],
  ["sessions", "Sessions"],
  ["advancements", "Advancements"],
  ["deaths", "Deaths"],
  ["more", "More"],
] as const;

export function PlayerProfile({ name }: { name: string }) {
  const res = useApi<PlayerDetailResponse>(name ? `/players/${encodeURIComponent(name)}` : null);

  if (!name) {
    return (
      <EmptyState icon="users" title="No player selected">
        Pick a player from the <Link href="/" className="text-accent underline-offset-2 hover:underline">timeline</Link>.
      </EmptyState>
    );
  }
  if (res.status === "error" && !res.data) {
    return "status" in res.error && (res.error as { status: number }).status === 404 ? (
      <EmptyState icon="users" title={`No player called “${name}”`}>
        They might not have joined yet, or changed their name. <Link href="/" className="text-accent hover:underline">Back to the timeline</Link>.
      </EmptyState>
    ) : (
      <ErrorState error={res.error} onRetry={res.reload} />
    );
  }
  if (!res.data) return <ProfileSkeleton />;
  return <Profile data={res.data} />;
}

function Profile({ data }: { data: PlayerDetailResponse }) {
  const { player, stats } = data;
  const now = useNow();
  const color = player.color;

  const today = now > 0 ? isoDateInZone(now, stats.timeZone) : (stats.daily.at(-1)?.date ?? "2026-01-01");
  // Show from the player's first day (14–30 days) so a new player's chart isn't mostly empty.
  const daysKnown = stats.daily.length ? daysBetween(stats.daily[0]!.date, today) + 1 : 14;
  const chartDays = Math.min(30, Math.max(14, daysKnown));
  const calendarWeeks = Math.min(26, Math.max(8, Math.ceil(daysKnown / 7) + 1));
  const lastDays = useMemo(() => lastNDays(stats.daily, today, chartDays), [stats.daily, today, chartDays]);

  return (
    <div className="flex flex-col gap-10 pt-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-[var(--radius-card)] border border-line-soft bg-panel/80 p-5 sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{ background: `radial-gradient(600px 160px at 0% 0%, ${color}, transparent 70%)` }}
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar uuid={player.uuid} name={player.name} color={color} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-3xl font-semibold tracking-tight">{player.name}</h1>
              {player.online ? <OnlineBadge /> : <span className="text-sm text-ink-3">Last seen {formatRelative(player.lastSeen)}</span>}
            </div>
            <p className="mt-1 text-sm text-ink-2">
              Joined {formatDate(stats.firstSeen ?? player.firstSeen)}
              {data.formerNames.length ? <span className="text-ink-3"> · formerly {data.formerNames.join(", ")}</span> : null}
            </p>
            {player.highlights.length ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Highlights">
                {player.highlights.map((h) => {
                  const def = statById(h.statId);
                  if (!def) return null;
                  return (
                    <li key={h.statId} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/60 px-2.5 py-1 text-xs">
                      <Icon name={def.icon} className="size-3.5 text-ink-3" />
                      <span className="font-semibold">{formatStatValue(h.value, def.unit)}</span>
                      <span className="text-ink-2">{statNoun(def, h.value)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
        <nav aria-label="Sections" className="relative -mx-1 mt-5 flex gap-1 overflow-x-auto border-t border-line-soft pt-3">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
      </header>

      {/* Overview */}
      <Section id="overview" title="Overview" action={<ProvenanceTag kind="derived" />}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="col-span-2 row-span-2 [&>*]:h-full [&>*]:justify-center">
            <StatTile hero label="Total playtime" icon="clock" value={formatDuration(stats.playtimeSeconds)} detail={`${formatNumber(stats.activeDays)} active ${stats.activeDays === 1 ? "day" : "days"}`} />
          </div>
          <StatTile label="Sessions" icon="bolt" value={formatNumber(stats.sessionCount)} />
          <StatTile label="Average session" icon="clock" value={formatDuration(stats.averageSessionSeconds)} detail={`median ${formatDuration(stats.medianSessionSeconds)}`} />
          <StatTile
            label="Longest session"
            icon="star"
            value={stats.longestSession ? formatDuration(stats.longestSession.seconds) : "—"}
            detail={stats.longestSession ? formatDate(stats.longestSession.start) : undefined}
          />
          <StatTile label="Longest streak" icon="flame" value={formatStatValue(stats.longestStreakDays, "days")} detail={stats.currentStreakDays > 1 ? `${stats.currentStreakDays} days running now` : undefined} />
          <StatTile label="First seen" icon="calendar" value={stats.firstSeen ? formatDate(stats.firstSeen) : "—"} />
          <StatTile label="Last seen" icon="calendar" value={player.online ? "Online now" : stats.lastSeen ? formatRelative(stats.lastSeen) : "—"} detail={stats.lastSeen && !player.online ? formatDateTime(stats.lastSeen) : undefined} />
          <StatTile label="Active days" icon="calendar" value={formatNumber(stats.activeDays)} />
          <StatTile label="Advancements" icon="trophy" value={formatNumber(stats.advancements.total)} />
        </div>
      </Section>

      {/* Activity */}
      <Section id="activity" title="Activity" description={`Days and hours in ${tzLabel(stats.timeZone)}.`} action={<ProvenanceTag kind="derived" />}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-medium text-ink-2">Playtime per day · last {chartDays} days</h3>
            <ColumnChart
              data={lastDays.map((d, i) => ({
                key: d.date,
                label: (lastDays.length - 1 - i) % 5 === 0 ? formatBucketDate(d.date) : "",
                value: d.seconds,
                title: formatBucketDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
              }))}
              color={color}
              formatValue={formatDuration}
              formatTick={formatDurationCompact}
              durationAxis
              ariaLabel={`Playtime per day over the last ${chartDays} days`}
            />
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-medium text-ink-2">
              Time of day {stats.favoriteHour !== null ? <span className="text-ink-3">· peak around {formatHour(stats.favoriteHour)}</span> : null}
            </h3>
            <ColumnChart
              data={stats.hourly.map((v, h) => ({ key: String(h), label: h % 6 === 0 ? formatHour(h) : "", value: v, title: `${formatHour(h)} – ${formatHour((h + 1) % 24)}` }))}
              color={color}
              height={140}
              formatValue={formatDuration}
              formatTick={formatDurationCompact}
              durationAxis
              ariaLabel="Playtime by hour of day"
            />
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-medium text-ink-2">Day of week</h3>
            <ColumnChart
              data={stats.weekday.map((v, i) => ({ key: WEEKDAYS[i]!, label: WEEKDAYS[i]!, value: v, title: WEEKDAYS[i]! }))}
              color={color}
              height={140}
              formatValue={formatDuration}
              formatTick={formatDurationCompact}
              durationAxis
              ariaLabel="Playtime by day of week"
            />
          </Card>
          <Card className="p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-medium text-ink-2">Activity calendar</h3>
            <CalendarHeatmap daily={stats.daily} color={color} endDate={today} weeks={calendarWeeks} />
          </Card>
        </div>
      </Section>

      <Section id="timeline" title="Session timeline" description="Scroll to zoom, drag to pan.">
        <PlayerTimeline player={player} />
      </Section>

      <Section id="sessions" title="Session history">
        <SessionHistory playerName={player.name} />
      </Section>

      {/* Advancements */}
      <Section
        id="advancements"
        title="Advancements"
        description="Announced in chat when earned. Only advancements earned since logging began are known."
        action={<ProvenanceTag kind="observed" />}
      >
        {stats.advancements.total === 0 ? (
          <Card>
            <EmptyState icon="trophy" title="No advancements yet" />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="grid grid-cols-3 content-start gap-3 lg:grid-cols-1">
              <StatTile label="Advancements" icon="trophy" value={formatNumber(stats.advancements.byKind.task)} />
              <StatTile label="Goals" icon="star" value={formatNumber(stats.advancements.byKind.goal)} />
              <StatTile label="Challenges" icon="flame" value={formatNumber(stats.advancements.byKind.challenge)} />
            </div>
            <Card className="max-h-[420px] overflow-auto lg:col-span-2">
              <ol className="divide-y divide-line-soft">
                {[...stats.advancements.list].reverse().map((a) => (
                  <li key={a.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-md border ${
                        a.kind === "challenge" ? "border-ink-3 bg-raised text-ink" : "border-line bg-bg text-ink-3"
                      }`}
                      title={a.kind}
                    >
                      <Icon name={a.kind === "challenge" ? "flame" : a.kind === "goal" ? "star" : "trophy"} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      <div className="text-xs capitalize text-ink-3">{a.kind === "task" ? "Advancement" : a.kind}</div>
                    </div>
                    <time className="shrink-0 text-xs text-ink-3" dateTime={a.earnedAt}>
                      {formatDateTime(a.earnedAt)}
                    </time>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        )}
      </Section>

      {/* Deaths */}
      <Section id="deaths" title="Deaths" description="From vanilla death messages." action={<ProvenanceTag kind="observed" />}>
        {stats.deaths.total === 0 ? (
          <Card>
            <EmptyState icon="skull" title="Never died">
              Not a single death message in the logs. Impressive.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="grid grid-cols-2 content-start gap-3 lg:grid-cols-1">
              <StatTile label="Deaths" icon="skull" value={formatNumber(stats.deaths.total)} detail={stats.deaths.perHour !== null ? `${formatNumber(stats.deaths.perHour, 2)} per hour played` : undefined} />
              <StatTile label="Nemesis" icon="sword" value={stats.deaths.topKiller?.name ?? "—"} detail={stats.deaths.topKiller ? `${stats.deaths.topKiller.count} ${stats.deaths.topKiller.count === 1 ? "kill" : "kills"}` : "No killer recorded"} />
            </div>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium text-ink-2">By category</h3>
              <BarList items={stats.deaths.byCategory.map((c) => ({ label: CATEGORY_LABEL[c.category], value: c.count }))} color={color} />
              <h3 className="mb-3 mt-5 text-sm font-medium text-ink-2">Top causes</h3>
              <BarList items={stats.deaths.topCauses.map((c) => ({ label: c.label, value: c.count }))} color={color} />
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium text-ink-2">Recent deaths</h3>
              <ol className="space-y-2.5">
                {stats.deaths.recent.map((d) => (
                  <li key={d.ts} className="text-sm">
                    <div className="text-ink">{d.message}</div>
                    <time className="text-xs text-ink-3" dateTime={d.ts}>
                      {formatDateTime(d.ts)}
                    </time>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        )}
      </Section>

      {/* More */}
      <Section id="more" title="More stats">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Chat messages" icon="chat" value={formatNumber(stats.chat.messages)} detail={stats.chat.perHour !== null ? `${formatNumber(stats.chat.perHour, 1)} per hour played` : "Counts only — never message content"} />
          <StatTile label="Night owl" icon="moon" value={formatPercent(stats.nightShare)} detail="of playtime between midnight and 6 AM" />
          <StatTile label="Favourite hour" icon="clock" value={stats.favoriteHour !== null ? formatHour(stats.favoriteHour) : "—"} />
          <Card className="flex flex-col gap-1 p-4">
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              <Icon name="users" className="size-3.5" /> Plays most with
            </span>
            {data.topCompanion ? (
              <>
                <Link href={`/player/?name=${encodeURIComponent(data.topCompanion.name)}`} className="flex items-center gap-2 text-xl font-semibold tracking-tight hover:underline">
                  <Avatar uuid={data.topCompanion.uuid} name={data.topCompanion.name} color={data.topCompanion.color} size={22} />
                  {data.topCompanion.name}
                </Link>
                <span className="text-xs text-ink-3">{formatDuration(data.topCompanion.seconds)} online together</span>
              </>
            ) : (
              <span className="text-xl font-semibold">—</span>
            )}
          </Card>
        </div>
        <DataNotes estimatedShare={stats.estimatedEndShare} />
      </Section>
    </div>
  );
}

function DataNotes({ estimatedShare }: { estimatedShare: number }) {
  return (
    <Card className="mt-4 p-4 text-sm text-ink-2">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">
        <Icon name="info" className="size-3.5" /> About this data
      </h3>
      <ul className="list-disc space-y-1 pl-5 marker:text-ink-3">
        <li>Everything here comes from the vanilla server log. Playtime is reconstructed from join and leave messages.</li>
        {estimatedShare > 0 ? (
          <li>
            {formatPercent(estimatedShare)} of sessions have an estimated end time (server crash or a leave that wasn&apos;t logged).
          </li>
        ) : null}
        <li>
          Vanilla logs don&apos;t record blocks mined, mobs killed, distance travelled or items crafted, so those aren&apos;t shown.
        </li>
      </ul>
    </Card>
  );
}

function lastNDays(daily: { date: string; seconds: number }[], endDate: string, n: number) {
  const byDate = new Map(daily.map((d) => [d.date, d.seconds]));
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, seconds: byDate.get(date) ?? 0 };
  });
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function tzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6 pt-6" aria-busy aria-label="Loading player">
      <Skeleton className="h-44 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
