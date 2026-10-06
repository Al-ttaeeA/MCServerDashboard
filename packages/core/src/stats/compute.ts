import { deathCategory, type DeathCategory } from "../parser/death-messages";
import type { AdvancementKind, LogEvent } from "../parser/types";
import { ESTIMATED_END_REASONS, type BuiltServerRun, type SessionEndReason } from "../sessions/build-sessions";
import { isoDateInZone } from "../time/zoned";
import { daysBetween, forEachLocalHour } from "./buckets";
import { STATS_VERSION, type PlayerStats, type ServerStats } from "./types";

export interface StatsSession {
  playerKey: string;
  startTs: number;
  endTs: number;
  endReason: SessionEndReason;
}

export interface StatsEvent {
  playerKey: string | null;
  ts: number;
  event: LogEvent;
}

export interface StatsInput {
  playerKeys: readonly string[];
  sessions: readonly StatsSession[];
  /** Only DEATH / ADVANCEMENT / CHAT / SERVER_START events are used. */
  events: readonly StatsEvent[];
  serverRuns: readonly BuiltServerRun[];
  /** Timezone for day/hour buckets (the community's timezone). */
  timeZone: string;
  /** "Today" for streaks. */
  now: number;
}

export interface StatsOutput {
  players: Map<string, PlayerStats>;
  server: ServerStats;
}

/** Below this much playtime, per-hour rates are too noisy to show. */
const MIN_HOURS_FOR_RATES = 1;

const iso = (ms: number) => new Date(ms).toISOString();

export function computeStats(input: StatsInput): StatsOutput {
  const { timeZone } = input;
  const sessionsBy = groupBy(input.sessions, (s) => s.playerKey);
  const eventsBy = groupBy(
    input.events.filter((e) => e.playerKey !== null),
    (e) => e.playerKey!,
  );
  const companions = companionSeconds(input.sessions);

  const players = new Map<string, PlayerStats>();
  for (const key of input.playerKeys) {
    players.set(
      key,
      computePlayer(sessionsBy.get(key) ?? [], eventsBy.get(key) ?? [], companions.get(key), timeZone, input.now),
    );
  }

  return { players, server: computeServer(input, players) };
}

function computePlayer(
  sessions: readonly StatsSession[],
  events: readonly StatsEvent[],
  companions: Map<string, number> | undefined,
  timeZone: string,
  now: number,
): PlayerStats {
  const durations = sessions.map((s) => (s.endTs - s.startTs) / 1000);
  const playtime = sum(durations);
  const hours = playtime / 3600;

  const daily = new Map<string, number>();
  const hourly = new Array<number>(24).fill(0);
  const weekday = new Array<number>(7).fill(0);
  for (const s of sessions) {
    forEachLocalHour(s.startTs, s.endTs, timeZone, (slice) => {
      daily.set(slice.date, (daily.get(slice.date) ?? 0) + slice.seconds);
      hourly[slice.hour]! += slice.seconds;
      weekday[slice.weekday]! += slice.seconds;
    });
  }
  const days = [...daily.keys()].sort();
  const streaks = computeStreaks(days, isoDateInZone(now, timeZone));

  let longest: StatsSession | null = null;
  for (const s of sessions) if (!longest || s.endTs - s.startTs > longest.endTs - longest.startTs) longest = s;

  const deathEvents = events.filter(
    (e): e is StatsEvent & { event: Extract<LogEvent, { type: "DEATH" }> } => e.event.type === "DEATH",
  );
  const advEvents = events.filter(
    (e): e is StatsEvent & { event: Extract<LogEvent, { type: "ADVANCEMENT" }> } => e.event.type === "ADVANCEMENT",
  );
  const chatCount = events.filter((e) => e.event.type === "CHAT").length;

  const timestamps = [
    ...sessions.flatMap((s) => [s.startTs, s.endTs]),
    ...events.map((e) => e.ts),
  ];
  const nightSeconds = sum(hourly.slice(0, 6));
  const favoriteHour = playtime > 0 ? hourly.indexOf(Math.max(...hourly)) : null;

  let topCompanion: PlayerStats["topCompanion"] = null;
  for (const [playerKey, seconds] of companions ?? []) {
    if (seconds > 0 && (!topCompanion || seconds > topCompanion.seconds)) topCompanion = { playerKey, seconds };
  }

  return {
    version: STATS_VERSION,
    timeZone,
    playtimeSeconds: Math.round(playtime),
    sessionCount: sessions.length,
    averageSessionSeconds: sessions.length ? Math.round(playtime / sessions.length) : 0,
    medianSessionSeconds: Math.round(median(durations)),
    longestSession: longest
      ? { seconds: Math.round((longest.endTs - longest.startTs) / 1000), start: iso(longest.startTs), end: iso(longest.endTs) }
      : null,
    firstSeen: timestamps.length ? iso(Math.min(...timestamps)) : null,
    lastSeen: timestamps.length ? iso(Math.max(...timestamps)) : null,
    activeDays: days.length,
    longestStreakDays: streaks.longest,
    currentStreakDays: streaks.current,
    estimatedEndShare: sessions.length
      ? sessions.filter((s) => ESTIMATED_END_REASONS.has(s.endReason)).length / sessions.length
      : 0,
    daily: days.map((date) => ({ date, seconds: Math.round(daily.get(date)!) })),
    hourly: hourly.map(Math.round),
    weekday: weekday.map(Math.round),
    nightShare: playtime > 0 ? nightSeconds / playtime : 0,
    favoriteHour,
    deaths: summarizeDeaths(deathEvents, hours),
    advancements: summarizeAdvancements(advEvents),
    chat: { messages: chatCount, perHour: hours >= MIN_HOURS_FOR_RATES ? chatCount / hours : null },
    topCompanion: topCompanion ? { ...topCompanion, seconds: Math.round(topCompanion.seconds) } : null,
  };
}

function summarizeDeaths(
  deaths: readonly (StatsEvent & { event: Extract<LogEvent, { type: "DEATH" }> })[],
  hours: number,
): PlayerStats["deaths"] {
  const byCategory = new Map<DeathCategory, number>();
  const byCause = new Map<string, number>();
  const byKiller = new Map<string, number>();
  for (const { event } of deaths) {
    const category = deathCategory(event.cause);
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    const label = causeLabel(event);
    byCause.set(label, (byCause.get(label) ?? 0) + 1);
    if (event.killer) byKiller.set(event.killer, (byKiller.get(event.killer) ?? 0) + 1);
  }
  const top = topEntries(byKiller, 1)[0];
  return {
    total: deaths.length,
    perHour: hours >= MIN_HOURS_FOR_RATES ? deaths.length / hours : null,
    byCategory: topEntries(byCategory).map(([category, count]) => ({ category, count })),
    topCauses: topEntries(byCause, 8).map(([label, count]) => ({ label, count })),
    topKiller: top ? { name: top[0], count: top[1] } : null,
    recent: deaths
      .slice(-10)
      .reverse()
      .map((d) => ({ ts: iso(d.ts), message: d.event.message })),
  };
}

/** `Alex was slain by Zombie using [Iron Sword]` → `Slain by Zombie`. */
export function causeLabel(event: Extract<LogEvent, { type: "DEATH" }>): string {
  let text = event.message.startsWith(event.player + " ") ? event.message.slice(event.player.length + 1) : event.message;
  if (event.weapon) text = text.replace(/ (using|with|wielding) .+$/, "");
  text = text.replace(/^was /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function summarizeAdvancements(
  advs: readonly (StatsEvent & { event: Extract<LogEvent, { type: "ADVANCEMENT" }> })[],
): PlayerStats["advancements"] {
  const firstByName = new Map<string, { name: string; kind: AdvancementKind; earnedAt: number }>();
  for (const { ts, event } of advs) {
    if (!firstByName.has(event.advancement)) {
      firstByName.set(event.advancement, { name: event.advancement, kind: event.kind, earnedAt: ts });
    }
  }
  const list = [...firstByName.values()].sort((a, b) => a.earnedAt - b.earnedAt);
  const byKind: Record<AdvancementKind, number> = { task: 0, challenge: 0, goal: 0 };
  for (const a of list) byKind[a.kind]++;
  return { total: list.length, byKind, list: list.map((a) => ({ ...a, earnedAt: iso(a.earnedAt) })) };
}

function computeServer(input: StatsInput, players: Map<string, PlayerStats>): ServerStats {
  const { sessions, timeZone } = input;
  const daily = new Map<string, { seconds: number; players: Set<string> }>();
  const hourly = new Array<number>(24).fill(0);
  for (const s of sessions) {
    forEachLocalHour(s.startTs, s.endTs, timeZone, (slice) => {
      const d = daily.get(slice.date) ?? { seconds: 0, players: new Set<string>() };
      d.seconds += slice.seconds;
      d.players.add(s.playerKey);
      daily.set(slice.date, d);
      hourly[slice.hour]! += slice.seconds;
    });
  }
  const dailyList = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({ date, seconds: Math.round(d.seconds), players: d.players.size }));
  const busiest = dailyList.reduce<(typeof dailyList)[number] | null>((m, d) => (!m || d.seconds > m.seconds ? d : m), null);

  const versions: ServerStats["versions"] = [];
  for (const e of input.events) {
    if (e.event.type === "SERVER_START" && !versions.some((v) => v.version === (e.event as { version: string }).version)) {
      versions.push({ version: e.event.version, firstSeen: iso(e.ts) });
    }
  }

  const all = [...players.values()];
  const starts = sessions.map((s) => s.startTs);
  const ends = sessions.map((s) => s.endTs);
  return {
    version: STATS_VERSION,
    timeZone,
    playerCount: all.filter((p) => p.sessionCount > 0).length,
    sessionCount: sessions.length,
    totalPlaytimeSeconds: Math.round(sum(all.map((p) => p.playtimeSeconds))),
    peakConcurrent: peakConcurrent(sessions),
    busiestDay: busiest ? { date: busiest.date, seconds: busiest.seconds } : null,
    daily: dailyList,
    hourly: hourly.map(Math.round),
    deaths: sum(all.map((p) => p.deaths.total)),
    advancements: sum(all.map((p) => p.advancements.total)),
    chatMessages: sum(all.map((p) => p.chat.messages)),
    serverRuns: input.serverRuns.length,
    crashes: input.serverRuns.filter((r) => r.endReason === "crash").length,
    versions,
    firstActivity: starts.length ? iso(Math.min(...starts)) : null,
    lastActivity: ends.length ? iso(Math.max(...ends)) : null,
  };
}

/** Sweep line over session boundaries. Leaves sort before joins at equal times. */
export function peakConcurrent(sessions: readonly StatsSession[]): { count: number; at: string } | null {
  const points: [number, number][] = [];
  for (const s of sessions) {
    if (s.endTs <= s.startTs) continue;
    points.push([s.startTs, 1], [s.endTs, -1]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let best: { count: number; at: number } | null = null;
  for (const [t, delta] of points) {
    current += delta;
    if (!best || current > best.count) best = { count: current, at: t };
  }
  return best && best.count > 0 ? { count: best.count, at: iso(best.at) } : null;
}

/** For every pair of players, total seconds both were online at once. */
function companionSeconds(sessions: readonly StatsSession[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const sorted = [...sessions].sort((a, b) => a.startTs - b.startTs);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length && sorted[j]!.startTs < a.endTs; j++) {
      const b = sorted[j]!;
      if (a.playerKey === b.playerKey) continue;
      const overlap = (Math.min(a.endTs, b.endTs) - b.startTs) / 1000;
      if (overlap <= 0) continue;
      add(result, a.playerKey, b.playerKey, overlap);
      add(result, b.playerKey, a.playerKey, overlap);
    }
  }
  return result;
}

function add(m: Map<string, Map<string, number>>, a: string, b: string, v: number) {
  let inner = m.get(a);
  if (!inner) m.set(a, (inner = new Map()));
  inner.set(b, (inner.get(b) ?? 0) + v);
}

export function computeStreaks(sortedDays: readonly string[], today: string): { longest: number; current: number } {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    run = i > 0 && daysBetween(sortedDays[i - 1]!, sortedDays[i]!) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const last = sortedDays[sortedDays.length - 1];
  const current = last !== undefined && daysBetween(last, today) <= 1 ? run : 0;
  return { longest, current };
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = m.get(k);
    if (list) list.push(item);
    else m.set(k, [item]);
  }
  return m;
}

function topEntries<K>(m: Map<K, number>, limit = Infinity): [K, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
