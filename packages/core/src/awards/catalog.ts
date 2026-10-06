import type { PlayerFeatures } from "./features";
import { fmtDuration, fmtInt, fmtNumber } from "./format";
import type { AwardTitle, ExplainContext, MetricDefinition } from "./types";

/**
 * The award catalog.
 *
 * Each entry is ONE measured quantity. It may carry a HIGH title, a LOW
 * title, or both; uniqueness is enforced per metric, so e.g. total playtime
 * can produce "The Resident" or "The Touch Grass Award" — never both.
 *
 * Every metric's data was verified to exist on our server before it was
 * added (see docs/awards.md for the audit and the rejected list).
 *
 * To add an award: add one object here. Nothing else needs to change.
 */

type M = MetricDefinition<PlayerFeatures>;
const title = (emoji: string, name: string, line: (c: ExplainContext) => string, explain: (c: ExplainContext) => string): AwardTitle => ({
  emoji,
  title: name,
  line,
  explain,
});

// Common sample definitions.
const byHours = (min: number) => ({ sample: (f: PlayerFeatures) => f.playtimeH, minSample: min, halfConfidenceAt: 4 });
const bySessions = (min: number) => ({ sample: (f: PlayerFeatures) => f.sessionCount, minSample: min, halfConfidenceAt: 6 });
const byStatsHours = (min: number) => ({ sample: (f: PlayerFeatures) => f.statsPlaytimeH ?? 0, minSample: min, halfConfidenceAt: 3 });
const perHour = (count: number | null, hours: number | null) => (count === null || !hours ? null : count / hours);

export const METRICS: readonly M[] = [
  // ════════════════════════════ PLAYTIME ════════════════════════════
  {
    id: "playtime_total", family: "playtime", source: "LOG", unit: "hours", transform: "log1p", minSpread: 2,
    formula: "Sum of all session durations (join → leave) from the server log.",
    value: (f) => f.playtimeH, ...bySessions(1), reliability: 1,
    high: title("🏠", "The Resident", (c) => `${c.formatted} played`, (c) => `${c.name} has spent ${c.formatted} on the server — ${c.comparison}. At this point they should be paying rent.`),
    low: title("🌱", "The Touch Grass Award", (c) => `only ${c.formatted} played`, (c) => `${c.name} has played just ${c.formatted} — ${c.comparison}. Someone here has a healthy relationship with the outdoors.`),
  },
  {
    id: "playtime_per_day", family: "playtime", source: "DERIVED", unit: "hours", transform: "log1p", minSpread: 0.5,
    formula: "Total playtime ÷ number of distinct days with any play (community timezone).",
    value: (f) => f.playtimePerActiveDayH, sample: (f) => f.activeDays, minSample: 2, halfConfidenceAt: 3, reliability: 0.9,
    high: title("📈", "The No-Life Speedrun", (c) => `${c.formatted} per day played`, (c) => `When ${c.name} shows up, they commit: ${c.formatted} on an average active day — ${c.comparison}.`),
    low: title("☕", "The Casual", (c) => `${c.formatted} per day played`, (c) => `${c.name} keeps it light, averaging ${c.formatted} on days they play — ${c.comparison}.`),
  },
  {
    id: "server_time_share", family: "playtime", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Their playtime ÷ total time anyone at all was online.",
    value: (f) => f.serverTimeShare, ...bySessions(3), reliability: 0.9,
    high: title("🎬", "Main Character Syndrome", (c) => `online for ${c.formatted} of server activity`, (c) => `${c.name} was online for ${c.formatted} of all the time anyone was on the server — ${c.comparison}. The server basically revolves around them.`),
  },
  {
    id: "active_days", family: "playtime", source: "DERIVED", unit: "days", transform: "log1p", minSpread: 1,
    formula: "Number of distinct calendar days with any playtime.",
    value: (f) => f.activeDays, ...bySessions(2), reliability: 1,
    high: title("🔁", "The Returner", (c) => `${c.formatted} with playtime`, (c) => `${c.name} has logged in on ${c.formatted} — ${c.comparison}. They always come back.`),
  },
  {
    id: "longest_streak", family: "playtime", source: "DERIVED", unit: "days", transform: "log1p", minSpread: 1,
    formula: "Longest run of consecutive days with playtime.",
    value: (f) => f.longestStreakDays, ...bySessions(3), reliability: 1,
    high: title("🔥", "The Regular", (c) => `${c.formatted} in a row`, (c) => `${c.name} played ${c.formatted} straight without missing one — ${c.comparison}.`),
  },

  // ════════════════════════════ SESSIONS ════════════════════════════
  {
    id: "longest_session", family: "sessions", source: "LOG", unit: "duration", transform: "log1p", minSpread: 1800,
    formula: "Longest single session (join → leave).",
    value: (f) => f.longestSessionS, ...bySessions(2), reliability: 1,
    high: title("🏃", "The Marathon", (c) => `${c.formatted} longest session`, (c) => `${c.name} once stayed online for ${c.formatted} straight — ${c.comparison}. Hydration status: unknown.`),
  },
  {
    id: "session_count", family: "sessions", source: "LOG", unit: "count", transform: "log1p", minSpread: 2,
    formula: "Number of sessions.",
    value: (f) => f.sessionCount, ...bySessions(1), reliability: 1,
    high: title("🚪", "Can't Log Off", (c) => `${c.formatted} sessions`, (c) => `${c.name} has joined the server ${c.times} — ${c.comparison}. The door's practically a revolving one.`),
  },
  {
    id: "avg_session", family: "sessions", source: "LOG", unit: "duration", transform: "log1p", minSpread: 600,
    formula: "Mean session duration.",
    value: (f) => f.avgSessionS, ...bySessions(4), reliability: 1,
    high: title("💼", "The Weekend Employee", (c) => `${c.formatted} average session`, (c) => `${c.name}'s average session lasts ${c.formatted} — ${c.comparison}. That's a shift, not a session.`),
    low: title("🧳", "The Tourist", (c) => `${c.formatted} average session`, (c) => `${c.name} pops in for ${c.formatted} on average — ${c.comparison}. Just visiting.`),
  },
  {
    id: "session_cv", family: "sessions", source: "DERIVED", unit: "score", transform: "identity", minSpread: 0.15,
    formula: "Coefficient of variation of session lengths (standard deviation ÷ mean).",
    value: (f) => f.sessionCV, ...bySessions(6), reliability: 0.85,
    extra: (f) => ({ shortest: fmtDuration(f.shortestSessionS), longest: fmtDuration(f.longestSessionS) }),
    high: title("🌪️", "The Chaos Agent", () => `wildly varying session lengths`, (c) => `${c.name}'s sessions are all over the place — anywhere from ${c.extra.shortest} to ${c.extra.longest} (variation ${c.formatted}, ${c.comparison}).`),
    low: title("📏", "The Consistency Merchant", () => `remarkably consistent sessions`, (c) => `${c.name}'s sessions are clockwork — the most consistent lengths on the server (variation ${c.formatted}, ${c.comparison}).`),
  },
  {
    id: "longest_gap", family: "sessions", source: "DERIVED", unit: "hours", transform: "log1p", minSpread: 12,
    formula: "Longest break between two consecutive sessions.",
    value: (f) => f.longestGapH, ...bySessions(3), reliability: 0.9,
    high: title("🏔️", "The Hermit", (c) => `${c.formatted} longest break`, (c) => `${c.name} once vanished for ${c.formatted} before returning — ${c.comparison}.`),
  },
  {
    id: "short_share_10", family: "sessions", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.1, sensitive: "short_sessions",
    formula: "Share of sessions shorter than 10 minutes.",
    value: (f) => f.shortShare10, ...bySessions(6), reliability: 0.9,
    high: title("👀", "\"I'll Just Check Something\"", (c) => `${c.formatted} of sessions under 10 min`, (c) => `${c.formatted} of ${c.name}'s sessions are over in under ten minutes — ${c.comparison}. Just checking on the crops, apparently.`),
  },
  {
    id: "short_count_5", family: "sessions", source: "DERIVED", unit: "count", transform: "log1p", minSpread: 2, sensitive: "short_sessions",
    formula: "Number of sessions shorter than 5 minutes.",
    value: (f) => f.shortCount5, ...bySessions(5), reliability: 0.9,
    high: title("💔", "The Commitment Issues Award", (c) => `${c.formatted} sessions under 5 min`, (c) => `${c.name} has left within five minutes of joining ${c.times} — ${c.comparison}.`),
  },

  // ════════════════════════════ SCHEDULE ════════════════════════════
  {
    id: "night_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08, sensitive: "schedule",
    formula: "Share of playtime between 00:00 and 06:00 (community timezone).",
    value: (f) => f.nightShare, ...byHours(3), reliability: 1,
    high: title("🌙", "The Night Shift", (c) => `${c.formatted} late-night play`, (c) => `${c.name} spends ${c.formatted} of their playtime between midnight and 6 AM — ${c.comparison}.`),
  },
  {
    id: "morning_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of playtime between 06:00 and 12:00.",
    value: (f) => f.morningShare, ...byHours(3), reliability: 1,
    high: title("🌅", "The Morning Person", (c) => `${c.formatted} morning play`, (c) => `${c.formatted} of ${c.name}'s playtime happens before noon — ${c.comparison}. Suspiciously well-rested.`),
  },
  {
    id: "nine_to_five_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of playtime on weekdays between 09:00 and 17:00.",
    value: (f) => f.nineToFiveShare, ...byHours(3), reliability: 1,
    high: title("🗂️", "The 9-to-5er", (c) => `${c.formatted} during work hours`, (c) => `${c.formatted} of ${c.name}'s playtime falls on weekdays between 9 and 5 — ${c.comparison}. Minecraft is the job.`),
  },
  {
    id: "after_school_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of playtime between 15:00 and 19:00.",
    value: (f) => f.afterSchoolShare, ...byHours(3), reliability: 1,
    high: title("🎒", "The After-School Special", (c) => `${c.formatted} between 3 and 7 PM`, (c) => `${c.name} does ${c.formatted} of their playing between 3 and 7 PM — ${c.comparison}.`),
  },
  {
    id: "evening_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of playtime between 19:00 and midnight.",
    value: (f) => f.eveningShare, ...byHours(3), reliability: 1,
    high: title("🌆", "The Evening Shift", (c) => `${c.formatted} evening play`, (c) => `${c.formatted} of ${c.name}'s playtime is between 7 PM and midnight — ${c.comparison}.`),
  },
  {
    id: "lunch_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.04,
    formula: "Share of playtime between 11:30 and 13:30.",
    value: (f) => f.lunchShare, ...byHours(3), reliability: 1,
    high: title("🥪", "The Lunch Break", (c) => `${c.formatted} during lunch hours`, (c) => `${c.name} squeezes ${c.formatted} of their playtime into 11:30–1:30 — ${c.comparison}.`),
  },
  {
    id: "weekend_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.1,
    formula: "Share of playtime on Saturday and Sunday.",
    value: (f) => f.weekendShare, ...byHours(4), reliability: 1,
    high: title("🎉", "The Weekend Warrior", (c) => `${c.formatted} on weekends`, (c) => `${c.formatted} of ${c.name}'s playtime happens on weekends — ${c.comparison}.`),
    low: title("🗓️", "The Weekday Warrior", (c) => `${c.formatted} on weekends`, (c) => `Only ${c.formatted} of ${c.name}'s playtime is on weekends — ${c.comparison}. Weekdays are for Minecraft.`),
  },
  {
    id: "sunday_night_share", family: "schedule", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.04,
    formula: "Share of playtime on Sunday between 18:00 and midnight.",
    value: (f) => f.sundayNightShare, ...byHours(3), reliability: 1,
    high: title("😰", "The Sunday Scaries", (c) => `${c.formatted} on Sunday nights`, (c) => `${c.name} spends ${c.formatted} of their playtime on Sunday evenings — ${c.comparison}. Avoiding something?`),
  },
  {
    id: "typical_logout", family: "schedule", source: "DERIVED", unit: "clock", transform: "identity", minSpread: 0.75, sensitive: "schedule",
    formula: "Median logout time of day (measured from noon so late nights sort after evenings).",
    value: (f) => f.typicalLogout, ...bySessions(4), reliability: 0.9,
    high: title("🕒", "The 3AM Incident", (c) => `usually logs off at ${c.formatted}`, (c) => `${c.name}'s typical logout time is ${c.formatted} — ${c.comparison}. "One more thing" is doing a lot of work.`),
    low: title("🛏️", "The Early Retirement", (c) => `usually logs off at ${c.formatted}`, (c) => `${c.name} usually calls it a night at ${c.formatted} — ${c.comparison}. Responsible. Suspicious, but responsible.`),
  },
  {
    id: "sunrise_sessions", family: "schedule", source: "DERIVED", unit: "count", transform: "log1p", minSpread: 1, sensitive: "schedule",
    formula: "Sessions that were still going at 06:00.",
    value: (f) => f.sunriseSessions, ...bySessions(3), reliability: 1,
    high: title("🌄", "The Sunrise Enjoyer", (c) => `${c.formatted} sessions still going at 6 AM`, (c) => `${c.name} has watched the real sun come up mid-session ${c.times} — ${c.comparison}.`),
  },
  {
    id: "longest_overnight", family: "schedule", source: "DERIVED", unit: "duration", transform: "log1p", minSpread: 1800, sensitive: "schedule",
    formula: "Longest session that crossed midnight.",
    value: (f) => f.longestOvernightS, ...bySessions(2), reliability: 1,
    high: title("☕", "Sleep Is Optional", (c) => `${c.formatted} overnight session`, (c) => `${c.name}'s longest session through midnight lasted ${c.formatted} — ${c.comparison}.`),
  },
  {
    id: "schedule_entropy", family: "schedule", source: "DERIVED", unit: "score", transform: "identity", minSpread: 0.1,
    formula: "Normalised Shannon entropy of session start hours (0 = always the same hour, 1 = completely random).",
    value: (f) => f.scheduleEntropy, ...bySessions(8), reliability: 0.8,
    high: title("🌀", "The Circadian Disaster", () => `no two sessions start at the same time`, (c) => `${c.name} logs in at completely unpredictable hours (schedule chaos ${c.formatted}, ${c.comparison}). Time is a construct.`),
  },

  // ════════════════════════════ DEATHS ════════════════════════════
  {
    id: "deaths", family: "deaths", source: "LOG", unit: "count", transform: "log1p", minSpread: 2, sensitive: "deaths",
    formula: "Number of death messages in the log.",
    value: (f) => f.deaths, ...byHours(2), reliability: 1,
    high: title("🪦", "The Graveyard Regular", (c) => `${c.formatted} deaths`, (c) => `${c.name} has died ${c.times} — ${c.comparison}. The respawn screen knows them by name.`),
  },
  {
    id: "deaths_per_hour", family: "deaths", source: "DERIVED", unit: "per_hour", transform: "log1p", minSpread: 0.15, sensitive: "deaths",
    formula: "Deaths ÷ hours played.",
    value: (f) => perHour(f.deaths, f.playtimeH), ...byHours(4), reliability: 0.9,
    high: title("💀", "Respawn Any%", (c) => `a death every ${c.extra.every}`, (c) => `${c.name} averages one death every ${c.extra.every} of playtime — ${c.comparison}.`),
    low: title("🛡️", "The Immortal", (c) => `${c.formatted} deaths per hour`, (c) => `${c.name} dies just ${c.formatted} times per hour played — ${c.comparison}. Nothing on this server has figured them out.`),
    extra: (f) => ({ every: f.deaths > 0 ? fmtDuration((f.playtimeH * 3600) / f.deaths) : "never" }),
  },
  {
    id: "env_death_share", family: "deaths", source: "LOG", unit: "ratio", transform: "logit", minSpread: 0.15, sensitive: "deaths",
    formula: "Share of deaths caused by the environment (falls, lava, fire, drowning, suffocation, void…) rather than mobs.",
    value: (f) => f.envDeathShare, sample: (f) => f.deaths, minSample: 3, halfConfidenceAt: 4, reliability: 1,
    high: title("🧬", "The Darwin Award", (c) => `${c.formatted} of deaths self-inflicted`, (c) => `${c.formatted} of ${c.name}'s deaths had no mob involved at all — ${c.comparison}. The call was coming from inside the house.`),
  },
  {
    id: "mob_deaths", family: "deaths", source: "LOG", unit: "count", transform: "log1p", minSpread: 1, sensitive: "deaths",
    formula: "Deaths to mobs (melee or projectile).",
    value: (f) => f.mobDeaths, ...byHours(2), reliability: 1,
    high: title("⚔️", "The Violent End", (c) => `${c.formatted} deaths to mobs`, (c) => `${c.name} has been taken out by mobs ${c.times} — ${c.comparison}.`),
  },
  {
    id: "fall_deaths", family: "deaths", source: "LOG", unit: "count", transform: "log1p", minSpread: 1, sensitive: "deaths",
    formula: "Deaths from falling (including being knocked off ledges).",
    value: (f) => f.fallDeaths, ...byHours(2), reliability: 1,
    high: title("🪂", "The Fall Guy", (c) => `${c.formatted} fall deaths`, (c) => `Gravity has claimed ${c.name} ${c.times} — ${c.comparison}.`),
  },
  {
    id: "creeper_deaths", family: "deaths", source: "LOG", unit: "count", transform: "log1p", minSpread: 1, sensitive: "deaths",
    formula: "Deaths where the killer was a Creeper.",
    value: (f) => f.creeperDeaths, ...byHours(2), reliability: 1,
    high: title("💥", "Certified Creeper Victim", (c) => `blown up ${c.times}`, (c) => `${c.name} has been blown up by Creepers ${c.times} — ${c.comparison}. They hear "ssss" in their sleep.`),
  },
  {
    id: "lava_fire_deaths", family: "deaths", source: "LOG", unit: "count", transform: "log1p", minSpread: 1, sensitive: "deaths",
    formula: "Deaths from lava or fire.",
    value: (f) => f.lavaFireDeaths, ...byHours(2), reliability: 1,
    high: title("🌋", "The Lava Enthusiast", (c) => `${c.formatted} deaths by lava or fire`, (c) => `${c.name} has burned or melted ${c.times} — ${c.comparison}. The floor was lava, and they believed it.`),
  },
  {
    id: "drowning_deaths", family: "deaths", source: "LOG", unit: "count", transform: "log1p", minSpread: 1, sensitive: "deaths",
    formula: "Deaths by drowning.",
    value: (f) => f.drowningDeaths, ...byHours(2), reliability: 1,
    high: title("🌊", "The Water Is Fine", (c) => `drowned ${c.times}`, (c) => `${c.name} has drowned ${c.times} — ${c.comparison}. The water was, in fact, not fine.`),
  },
  {
    id: "longest_deathless", family: "deaths", source: "DERIVED", unit: "hours", transform: "log1p", minSpread: 1,
    formula: "Most playtime between two deaths (or since joining / since the last death).",
    value: (f) => f.longestDeathlessH, ...byHours(3), reliability: 0.95,
    high: title("🧘", "Unreasonably Alive", (c) => `${c.formatted} without dying`, (c) => `${c.name} once went ${c.formatted} of playtime without a single death — ${c.comparison}.`),
  },
  {
    id: "max_deaths_session", family: "deaths", source: "DERIVED", unit: "count", transform: "log1p", minSpread: 1, sensitive: "deaths",
    formula: "Most deaths within a single session.",
    value: (f) => (f.maxDeathsInSession >= 2 ? f.maxDeathsInSession : 0), ...byHours(2), reliability: 1,
    high: title("🐈", "The Nine Lives Problem", (c) => `${c.formatted} deaths in one session`, (c) => `${c.name} once died ${c.times} in a single session — ${c.comparison}.`),
  },
  {
    id: "shortest_death_gap", family: "deaths", source: "DERIVED", unit: "duration", transform: "log1p", minSpread: 120, sensitive: "deaths",
    formula: "Shortest time between two consecutive deaths.",
    value: (f) => f.shortestDeathGapS, sample: (f) => f.deaths, minSample: 2, halfConfidenceAt: 3, reliability: 1,
    low: title("🔂", "The Immediate Regret", (c) => `died twice within ${c.formatted}`, (c) => `${c.name} once died again just ${c.formatted} after respawning — ${c.comparison}.`),
  },
  {
    id: "damage_taken_rate", family: "deaths", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 20,
    formula: "Damage taken (hearts, from the statistics file) ÷ hours played.",
    value: (f) => perHour(f.damageTakenHearts, f.statsPlaytimeH), ...byStatsHours(2), reliability: 1,
    high: title("🥊", "The Punching Bag", (c) => `${c.formatted} hearts of damage per hour`, (c) => `${c.name} soaks up ${c.formatted} hearts of damage per hour — ${c.comparison}.`),
  },

  // ════════════════════════════ MINING ════════════════════════════
  {
    id: "blocks_mined", family: "mining", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 200,
    formula: "Total blocks mined (sum of the `mined` statistics).",
    value: (f) => f.blocksMined, ...byStatsHours(1), reliability: 1,
    high: title("⛏️", "The OSHA Violation", (c) => `${c.formatted} blocks mined`, (c) => `${c.name} has broken ${c.formatted} blocks — ${c.comparison}. No safety inspector would sign off on this.`),
  },
  {
    id: "mining_rate", family: "mining", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 50,
    formula: "Blocks mined ÷ hours played (statistics file playtime).",
    value: (f) => perHour(f.blocksMined, f.statsPlaytimeH), ...byStatsHours(2), reliability: 1,
    high: title("🏗️", "The Quarry", (c) => `${c.formatted} blocks mined per hour`, (c) => `${c.name} mines ${c.formatted} blocks per hour played — ${c.comparison}.`),
  },
  {
    id: "deepslate_share", family: "mining", source: "PLAYER_STATS", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of mined blocks that are deepslate-layer blocks (deepslate variants and tuff).",
    value: (f) => f.deepslateShare, sample: (f) => f.blocksMined ?? 0, minSample: 300, halfConfidenceAt: 800, reliability: 1,
    high: title("🕳️", "The Deep Dweller", (c) => `${c.formatted} of mining below Y=0`, (c) => `${c.formatted} of everything ${c.name} mines comes from the deepslate layer — ${c.comparison}. Daylight is a rumour.`),
  },
  {
    id: "logs_mined", family: "mining", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 50,
    formula: "Logs, stems, wood and hyphae harvested.",
    value: (f) => f.logsMined, ...byStatsHours(1), reliability: 1,
    high: title("🪓", "The Lumberjack", (c) => `${c.formatted} logs chopped`, (c) => `${c.name} has felled ${c.formatted} logs — ${c.comparison}. Several forests filed complaints.`),
  },
  {
    id: "diamond_ore", family: "mining", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 5,
    formula: "Diamond ore + deepslate diamond ore mined.",
    value: (f) => f.diamondOre, ...byStatsHours(1), reliability: 1,
    high: title("💎", "The Diamond Goblin", (c) => `${c.formatted} diamond ore mined`, (c) => `${c.name} has dug up ${c.formatted} diamond ore — ${c.comparison}. Check their pockets.`),
  },
  {
    id: "ore_rate", family: "mining", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 5,
    formula: "Ores (any *_ore block, plus ancient debris) mined ÷ hours played.",
    value: (f) => perHour(f.oresMined, f.statsPlaytimeH), ...byStatsHours(2), reliability: 1,
    high: title("🪨", "The Ore Addict", (c) => `${c.formatted} ores mined per hour`, (c) => `${c.name} mines ${c.formatted} ores per hour played — ${c.comparison}.`),
  },
  {
    id: "ore_share", family: "mining", source: "PLAYER_STATS", unit: "ratio", transform: "logit", minSpread: 0.02,
    formula: "Ores ÷ all blocks mined.",
    value: (f) => f.oreShare, sample: (f) => f.blocksMined ?? 0, minSample: 300, halfConfidenceAt: 800, reliability: 1,
    high: title("✨", "The Dirt Hater", (c) => `${c.formatted} of mined blocks are ores`, (c) => `${c.formatted} of what ${c.name} mines is ore — ${c.comparison}. Plain stone need not apply.`),
  },
  {
    id: "tools_broken", family: "mining", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 3,
    formula: "Tools and items worn out until they broke (sum of the `broken` statistics).",
    value: (f) => f.toolsBroken, ...byStatsHours(1), reliability: 1,
    high: title("🔨", "The Pickaxe Abuser", (c) => `${c.formatted} tools broken`, (c) => `${c.name} has used ${c.formatted} tools until they shattered — ${c.comparison}.`),
  },

  // ════════════════════════════ ITEMS ════════════════════════════
  {
    id: "picked_up", family: "items", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 300,
    formula: "Items picked up (sum of the `picked_up` statistics).",
    value: (f) => f.pickedUp, ...byStatsHours(1), reliability: 1,
    high: title("📦", "The Hoarder", (c) => `${c.formatted} items picked up`, (c) => `${c.name} has picked up ${c.formatted} items — ${c.comparison}. Every chest is full and they still need more.`),
  },
  {
    id: "dropped", family: "items", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 50,
    formula: "Items dropped (sum of the `dropped` statistics).",
    value: (f) => f.dropped, ...byStatsHours(1), reliability: 1,
    high: title("🗑️", "The Garbage Disposal", (c) => `${c.formatted} items dropped`, (c) => `${c.name} has thrown ${c.formatted} items on the floor — ${c.comparison}.`),
  },
  {
    id: "pickup_drop_ratio", family: "items", source: "PLAYER_STATS", unit: "score", transform: "log1p", minSpread: 5,
    formula: "Items picked up ÷ (items dropped + 1).",
    value: (f) => f.pickupDropRatio, sample: (f) => f.pickedUp ?? 0, minSample: 300, halfConfidenceAt: 1000, reliability: 1,
    high: title("🧹", "The Vacuum Cleaner", (c) => `keeps ${c.formatted} items for every one dropped`, (c) => `For every item ${c.name} drops, they pick up ${c.formatted} — ${c.comparison}. Nothing leaves.`),
  },
  {
    id: "crafted", family: "items", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 100,
    formula: "Items crafted (sum of the `crafted` statistics).",
    value: (f) => f.crafted, ...byStatsHours(1), reliability: 1,
    high: title("🏭", "The Assembly Line", (c) => `${c.formatted} items crafted`, (c) => `${c.name} has crafted ${c.formatted} items — ${c.comparison}.`),
  },
  {
    id: "containers", family: "items", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 30,
    formula: "Chests, barrels, shulker boxes and ender chests opened.",
    value: (f) => f.containersOpened, ...byStatsHours(1), reliability: 1,
    high: title("🗃️", "The Chest Goblin", (c) => `${c.formatted} containers opened`, (c) => `${c.name} has opened storage ${c.times} — ${c.comparison}. Reorganising, probably.`),
  },

  // ════════════════════════════ MOVEMENT ════════════════════════════
  {
    id: "distance", family: "movement", source: "PLAYER_STATS", unit: "km", transform: "log1p", minSpread: 3,
    formula: "Distance travelled by any means (walk, sprint, swim, boat, horse, elytra… — every *_one_cm statistic except falling).",
    value: (f) => f.distanceKm, ...byStatsHours(1), reliability: 1,
    high: title("🧭", "The Wanderer", (c) => `${c.formatted} travelled`, (c) => `${c.name} has covered ${c.formatted} — ${c.comparison}. Not all who wander are lost (some are).`),
  },
  {
    id: "distance_rate", family: "movement", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 0.5,
    formula: "Kilometres travelled ÷ hours played.",
    value: (f) => perHour(f.distanceKm, f.statsPlaytimeH), ...byStatsHours(2), reliability: 1,
    high: title("💨", "The Speed Demon", (c) => `${c.extra.km} km per hour played`, (c) => `${c.name} covers ${c.extra.km} km for every hour online — ${c.comparison}. Never standing still.`),
    low: title("🛋️", "The Basement Dweller", (c) => `${c.extra.km} km per hour played`, (c) => `${c.name} moves just ${c.extra.km} km per hour online — ${c.comparison}. The base is cosy and they know it.`),
    extra: (f) => ({ km: fmtNumber(perHour(f.distanceKm, f.statsPlaytimeH) ?? 0, 1) }),
  },
  {
    id: "jump_rate", family: "movement", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 100,
    formula: "Jumps ÷ hours played.",
    value: (f) => perHour(f.jumps, f.statsPlaytimeH), ...byStatsHours(2), reliability: 1,
    high: title("🦘", "The Parkour Incident", (c) => `${c.formatted} jumps per hour`, (c) => `${c.name} jumps ${c.formatted} times per hour — ${c.comparison}. Walking is for other people.`),
  },
  {
    id: "sneak_share", family: "movement", source: "PLAYER_STATS", unit: "ratio", transform: "logit", minSpread: 0.01,
    formula: "Time spent sneaking ÷ playtime.",
    value: (f) => f.sneakShare, ...byStatsHours(2), reliability: 1,
    high: title("🥷", "The Professional Squatter", (c) => `${c.formatted} of playtime crouched`, (c) => `${c.name} spends ${c.formatted} of their time sneaking — ${c.comparison}. Who are they hiding from?`),
  },
  {
    id: "sprint_share", family: "movement", source: "PLAYER_STATS", unit: "ratio", transform: "logit", minSpread: 0.05,
    formula: "Distance sprinted ÷ total distance.",
    value: (f) => f.sprintShare, sample: (f) => f.distanceKm ?? 0, minSample: 2, halfConfidenceAt: 5, reliability: 1,
    high: title("🏅", "The Track Star", (c) => `${c.formatted} of travel at a sprint`, (c) => `${c.formatted} of ${c.name}'s travel is at a full sprint — ${c.comparison}. Hunger bar? Never heard of it.`),
  },
  {
    id: "swim_distance", family: "movement", source: "PLAYER_STATS", unit: "km", transform: "log1p", minSpread: 0.3,
    formula: "Distance swum (on and under water).",
    value: (f) => f.swimKm, ...byStatsHours(1), reliability: 1,
    high: title("🐟", "The Fish", (c) => `${c.formatted} swum`, (c) => `${c.name} has swum ${c.formatted} — ${c.comparison}. Gills pending.`),
  },
  {
    id: "boat_distance", family: "movement", source: "PLAYER_STATS", unit: "km", transform: "log1p", minSpread: 0.3,
    formula: "Distance travelled by boat.",
    value: (f) => f.boatKm, ...byStatsHours(1), reliability: 1,
    high: title("⛵", "The Admiral", (c) => `${c.formatted} by boat`, (c) => `${c.name} has sailed ${c.formatted} — ${c.comparison}.`),
  },
  {
    id: "fall_distance", family: "movement", source: "PLAYER_STATS", unit: "km", transform: "log1p", minSpread: 0.1,
    formula: "Total distance fallen.",
    value: (f) => f.fallKm, ...byStatsHours(1), reliability: 1,
    high: title("🍎", "The Gravity Tester", (c) => `${c.formatted} fallen`, (c) => `${c.name} has fallen a combined ${c.formatted} — ${c.comparison}. Newton would like a word.`),
  },
  {
    id: "biomes", family: "movement", source: "ADVANCEMENTS", unit: "count", transform: "identity", minSpread: 3,
    formula: "Biomes visited (criteria of the Adventuring Time advancement).",
    value: (f) => f.biomesVisited, ...byStatsHours(1), reliability: 1,
    high: title("🗺️", "The Human GPS", (c) => `${c.formatted} biomes visited`, (c) => `${c.name} has set foot in ${c.formatted} different biomes — ${c.comparison}.`),
  },
  {
    id: "distance_per_advancement", family: "movement", source: "DERIVED", unit: "km", transform: "log1p", minSpread: 0.5,
    formula: "Kilometres travelled ÷ advancements earned.",
    value: (f) => (f.distanceKm === null || f.advancementsDone === null ? null : f.distanceKm / Math.max(1, f.advancementsDone)),
    ...byStatsHours(2), reliability: 0.8,
    high: title("🌫️", "The Lost Soul", (c) => `${c.formatted} travelled per advancement`, (c) => `${c.name} travels ${c.formatted} for every advancement earned — ${c.comparison}. Lots of journey, not much destination.`),
  },
  {
    id: "tourism_ratio", family: "movement", source: "DERIVED", unit: "km", transform: "log1p", minSpread: 0.5,
    formula: "Kilometres travelled per 1,000 blocks mined.",
    value: (f) => (f.distanceKm === null || f.blocksMined === null ? null : f.distanceKm / (f.blocksMined / 1000 + 0.5)),
    ...byStatsHours(2), reliability: 0.8,
    high: title("📸", "The Tourism Department", (c) => `${c.formatted} per 1,000 blocks mined`, (c) => `${c.name} travels ${c.formatted} for every thousand blocks they mine — ${c.comparison}. Here for the views.`),
  },

  // ════════════════════════════ COMBAT ════════════════════════════
  {
    id: "mob_kills", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 20,
    formula: "Mobs killed (the `mob_kills` statistic).",
    value: (f) => f.mobKills, ...byStatsHours(1), reliability: 1,
    high: title("☠️", "The Genocide", (c) => `${c.formatted} mobs killed`, (c) => `${c.name} has killed ${c.formatted} mobs — ${c.comparison}. The local wildlife has formed a support group.`),
  },
  {
    id: "hostile_kill_rate", family: "combat", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 3,
    formula: "Hostile mobs killed ÷ hours played.",
    value: (f) => perHour(f.hostileKills, f.statsPlaytimeH), ...byStatsHours(2), reliability: 1,
    high: title("🏹", "The Monster Hunter", (c) => `${c.formatted} hostile mobs killed per hour`, (c) => `${c.name} takes down ${c.formatted} hostile mobs per hour — ${c.comparison}.`),
    low: title("🕊️", "The Pacifist", (c) => `${c.formatted} hostile kills per hour`, (c) => `${c.name} kills just ${c.formatted} hostile mobs per hour — ${c.comparison}. Live and let live.`),
  },
  {
    id: "passive_kills", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 5,
    formula: "Passive/neutral animals killed (cows, pigs, sheep, chickens, fish…).",
    value: (f) => f.passiveKills, ...byStatsHours(1), reliability: 1,
    high: title("🥩", "The Butcher", (c) => `${c.formatted} animals killed`, (c) => `${c.name} has killed ${c.formatted} animals — ${c.comparison}. The cows have a wanted poster.`),
  },
  {
    id: "spiders_killed", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 3,
    formula: "Spiders and cave spiders killed.",
    value: (f) => f.spidersKilled, ...byStatsHours(1), reliability: 1,
    high: title("🕷️", "The Spider Problem", (c) => `${c.formatted} spiders killed`, (c) => `${c.name} has squashed ${c.formatted} spiders — ${c.comparison}. Personal vendetta suspected.`),
  },
  {
    id: "zombies_killed", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 3,
    formula: "Zombies, husks, drowned and zombie villagers killed.",
    value: (f) => f.zombiesKilled, ...byStatsHours(1), reliability: 1,
    high: title("🧟", "The Zombie Apocalypse", (c) => `${c.formatted} zombies killed`, (c) => `${c.name} has put down ${c.formatted} zombies — ${c.comparison}. They're ready for the real thing.`),
  },
  {
    id: "creepers_killed", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 2,
    formula: "Creepers killed.",
    value: (f) => f.creepersKilled, ...byStatsHours(1), reliability: 1,
    high: title("🪧", "The Creeper Union Buster", (c) => `${c.formatted} creepers killed`, (c) => `${c.name} has taken out ${c.formatted} creepers — ${c.comparison}.`),
  },
  {
    id: "mob_types", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "identity", minSpread: 2,
    formula: "Distinct mob types killed at least once.",
    value: (f) => f.mobTypesKilled, ...byStatsHours(1), reliability: 1,
    high: title("📒", "The Monster Collector", (c) => `${c.formatted} different mob types killed`, (c) => `${c.name} has killed ${c.formatted} different kinds of mob — ${c.comparison}. Gotta kill 'em all.`),
  },
  {
    id: "shield_blocked", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 10,
    formula: "Damage blocked with a shield (hearts).",
    value: (f) => f.shieldBlocked, ...byStatsHours(1), reliability: 1,
    high: title("🐢", "The Turtle", (c) => `${c.formatted} hearts blocked by shield`, (c) => `${c.name} has blocked ${c.formatted} hearts of damage with a shield — ${c.comparison}.`),
  },
  {
    id: "player_kills", family: "combat", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 1,
    formula: "Players killed (the `player_kills` statistic; inactive until someone has a kill).",
    value: (f) => f.playerKills, ...byStatsHours(1), reliability: 1,
    high: title("🩸", "The Bloodhound", (c) => `${c.formatted} player kills`, (c) => `${c.name} has killed other players ${c.times} — ${c.comparison}. Sleep with one eye open.`),
  },

  // ════════════════════════════ PROGRESSION ════════════════════════════
  {
    id: "advancements", family: "progression", source: "ADVANCEMENTS", unit: "count", transform: "identity", minSpread: 3,
    formula: "Advancements completed (from the advancements file; recipe unlocks and tab roots excluded).",
    value: (f) => f.advancementsDone, ...byStatsHours(1), reliability: 1,
    high: title("🏆", "The Completionist", (c) => `${c.formatted} advancements`, (c) => `${c.name} has completed ${c.formatted} advancements — ${c.comparison}.`),
    low: title("📉", "The Completionist's Nightmare", (c) => `${c.formatted} advancements`, (c) => `${c.name} has completed ${c.formatted} advancements — ${c.comparison}. The advancement menu remains a mystery.`),
  },
  {
    id: "advancement_rate", family: "progression", source: "DERIVED", unit: "per_hour", transform: "log1p", minSpread: 0.3,
    formula: "Advancements completed ÷ hours played.",
    value: (f) => perHour(f.advancementsDone, f.statsPlaytimeH), ...byStatsHours(3), reliability: 0.9,
    high: title("🚀", "The Overachiever", (c) => `${c.formatted} advancements per hour`, (c) => `${c.name} earns ${c.formatted} advancements per hour played — ${c.comparison}.`),
    low: title("🎣", "The Productivity Scam", (c) => `${c.formatted} advancements per hour`, (c) => `${c.name} earns just ${c.formatted} advancements per hour played — ${c.comparison}. Busy doing… something.`),
  },
  {
    id: "milestone_hours", family: "progression", source: "DERIVED", unit: "hours", transform: "log1p", minSpread: 0.5,
    formula: "Average playtime (from the log) before reaching key milestones: Acquire Hardware, Diamonds!, the Nether, a Fortress, Eye Spy, the End.",
    value: (f) => f.milestoneHours, sample: (f) => f.milestoneCount, minSample: 2, halfConfidenceAt: 2, reliability: 0.85,
    low: title("⏱️", "The Speedrunner Wannabe", (c) => `${c.formatted} to each milestone`, (c) => `${c.name} reaches the big milestones after just ${c.formatted} of playtime on average — ${c.comparison}.`),
    high: title("🐌", "The Procrastinator", (c) => `${c.formatted} to each milestone`, (c) => `${c.name} takes ${c.formatted} of playtime on average to hit each big milestone — ${c.comparison}. They'll get there. Eventually.`),
  },
  {
    id: "first_to", family: "progression", source: "ADVANCEMENTS", unit: "count", transform: "log1p", minSpread: 2,
    formula: "Advancements this player completed before anyone else on the server.",
    value: (f) => f.firstToCount, ...byStatsHours(1), reliability: 1,
    high: title("🥇", "The First Blood", (c) => `first on the server to ${c.formatted} advancements`, (c) => `${c.name} got to ${c.formatted} advancements before anyone else on the server — ${c.comparison}.`),
  },
  {
    id: "side_quests", family: "progression", source: "ADVANCEMENTS", unit: "count", transform: "log1p", minSpread: 5,
    formula: "Criteria completed in long checklist advancements (Adventuring Time, Monsters Hunted, A Balanced Diet, Two by Two…).",
    value: (f) => f.sideQuestCriteria, ...byStatsHours(1), reliability: 1,
    high: title("🧩", "The Side-Quest Merchant", (c) => `${c.formatted} side-quest criteria ticked off`, (c) => `${c.name} has ticked off ${c.formatted} boxes on the long checklist advancements — ${c.comparison}.`),
  },
  {
    id: "late_bloomer", family: "progression", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.1,
    formula: "Share of their advancements earned in the second half of their own playtime.",
    value: (f) => f.lateBloomerShare, sample: (f) => f.advancementsDone ?? 0, minSample: 6, halfConfidenceAt: 8, reliability: 0.85,
    high: title("🌸", "The Late Bloomer", (c) => `${c.formatted} of advancements in their second half`, (c) => `${c.formatted} of ${c.name}'s advancements came in the second half of their playtime — ${c.comparison}. A slow start, then a sprint.`),
  },
  {
    id: "historian", family: "progression", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.1,
    formula: "Time between their first and latest advancement ÷ the server's lifespan.",
    value: (f) => f.historianSpread, sample: (f) => f.advancementsDone ?? 0, minSample: 6, halfConfidenceAt: 8, reliability: 0.85,
    high: title("📜", "The Historian", (c) => `advancements across ${c.formatted} of the server's life`, (c) => `${c.name}'s advancements span ${c.formatted} of the server's whole history — ${c.comparison}.`),
  },
  {
    id: "xp_level", family: "progression", source: "PLAYER_DATA", unit: "count", transform: "log1p", minSpread: 5,
    formula: "Current XP level (player data).",
    value: (f) => f.xpLevel, ...byStatsHours(1), reliability: 1,
    high: title("🟢", "The XP Hoarder", (c) => `level ${c.formatted}`, (c) => `${c.name} is sitting on level ${c.formatted} — ${c.comparison}. Those enchantments aren't going to buy themselves.`),
  },
  {
    id: "dragon", family: "progression", source: "PLAYER_DATA", unit: "count", transform: "identity", minSpread: 1,
    formula: "Has seen the End credits (beaten the Ender Dragon). Only awarded when exactly one player has.",
    value: (f) => f.seenCredits, ...byStatsHours(1), reliability: 1,
    high: title("🐉", "The Dragon Slayer", () => `beat the Ender Dragon`, (c) => `${c.name} is the only one who has seen the End credits.`),
  },
  {
    id: "trades", family: "progression", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 5,
    formula: "Villager trades.",
    value: (f) => f.trades, ...byStatsHours(1), reliability: 1,
    high: title("🤑", "The Villager Exploiter", (c) => `${c.formatted} trades`, (c) => `${c.name} has traded with villagers ${c.times} — ${c.comparison}. Hrmm.`),
  },
  {
    id: "animals_bred", family: "progression", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 5,
    formula: "Animals bred.",
    value: (f) => f.animalsBred, ...byStatsHours(1), reliability: 1,
    high: title("💘", "The Matchmaker", (c) => `${c.formatted} animals bred`, (c) => `${c.name} has bred ${c.formatted} animals — ${c.comparison}.`),
  },
  {
    id: "enchants", family: "progression", source: "PLAYER_STATS", unit: "count", transform: "log1p", minSpread: 3,
    formula: "Items enchanted.",
    value: (f) => f.enchants, ...byStatsHours(1), reliability: 1,
    high: title("🔮", "The Wizard", (c) => `${c.formatted} items enchanted`, (c) => `${c.name} has enchanted ${c.formatted} items — ${c.comparison}.`),
  },
  {
    id: "sleep_rate", family: "progression", source: "PLAYER_STATS", unit: "per_hour", transform: "log1p", minSpread: 0.3,
    formula: "Times slept in a bed ÷ hours played.",
    value: (f) => perHour(f.bedsSlept, f.statsPlaytimeH), ...byStatsHours(3), reliability: 1,
    high: title("😴", "Well Rested", (c) => `${c.formatted} beds slept in per hour`, (c) => `${c.name} sleeps ${c.formatted} times per hour played — ${c.comparison}. Phantoms don't stand a chance.`),
    low: title("👻", "Phantom Bait", (c) => `${c.formatted} beds slept in per hour`, (c) => `${c.name} sleeps just ${c.formatted} times per hour played — ${c.comparison}. The phantoms send their thanks.`),
  },

  // ════════════════════════════ CHAT ════════════════════════════
  {
    id: "chat_messages", family: "chat", source: "LOG", unit: "count", transform: "log1p", minSpread: 10, sensitive: "chat_volume",
    formula: "Chat messages sent (counted; content is never stored).",
    value: (f) => f.chatMessages, ...byHours(2), reliability: 1,
    high: title("🗣️", "The Yap Machine", (c) => `${c.formatted} messages sent`, (c) => `${c.name} has sent ${c.formatted} chat messages — ${c.comparison}.`),
  },
  {
    id: "chat_rate", family: "chat", source: "DERIVED", unit: "per_hour", transform: "log1p", minSpread: 1, sensitive: "chat_volume",
    formula: "Chat messages ÷ hours played.",
    value: (f) => perHour(f.chatMessages, f.playtimeH), ...byHours(4), reliability: 1,
    high: title("📢", "The Server Announcer", (c) => `${c.formatted} messages per hour`, (c) => `${c.name} sends ${c.formatted} chat messages per hour played — ${c.comparison}. Never a quiet moment.`),
    low: title("🤐", "The Silent Protagonist", (c) => `${c.extra.messages} messages in ${c.extra.hours}`, (c) => `${c.name} has played ${c.extra.hours} and sent ${c.extra.messages} messages (${c.formatted} per hour) — ${c.comparison}. Mysterious.`),
    extra: (f) => ({ messages: fmtInt(f.chatMessages), hours: fmtDuration(f.playtimeH * 3600) }),
  },
  {
    id: "late_night_messages", family: "chat", source: "LOG", unit: "count", transform: "log1p", minSpread: 3, sensitive: "chat_volume",
    formula: "Chat messages sent between 00:00 and 06:00.",
    value: (f) => f.lateNightMessages, ...byHours(2), reliability: 1,
    high: title("🦉", "The 3AM Yapper", (c) => `${c.formatted} messages after midnight`, (c) => `${c.name} has sent ${c.formatted} messages between midnight and 6 AM — ${c.comparison}.`),
  },
  {
    id: "replies", family: "chat", source: "DERIVED", unit: "count", transform: "log1p", minSpread: 3, sensitive: "chat_volume",
    formula: "Messages sent within 20 seconds of someone else's message.",
    value: (f) => f.replies, sample: (f) => f.chatMessages, minSample: 10, halfConfidenceAt: 20, reliability: 0.9,
    high: title("↩️", "The Reply Guy", (c) => `${c.formatted} instant replies`, (c) => `${c.name} has fired back within 20 seconds of someone else ${c.times} — ${c.comparison}.`),
  },
  {
    id: "message_length", family: "chat", source: "LOG", unit: "count", transform: "log1p", minSpread: 4, sensitive: "chat_style",
    formula: "Average message length in characters (from per-message length; text not stored).",
    value: (f) => f.avgMessageLength, sample: (f) => f.chatMessages, minSample: 15, halfConfidenceAt: 25, reliability: 1,
    high: title("📝", "The Essayist", (c) => `${c.formatted} characters per message`, (c) => `${c.name}'s messages average ${c.formatted} characters — ${c.comparison}. Chat is a blog.`),
    low: title("💬", "The One-Liner", (c) => `${c.formatted} characters per message`, (c) => `${c.name}'s messages average just ${c.formatted} characters — ${c.comparison}. Brevity is the soul of wit.`),
  },
  {
    id: "caps_share", family: "chat", source: "LOG", unit: "ratio", transform: "logit", minSpread: 0.08, sensitive: "chat_style",
    formula: "Average share of capital letters per message (messages with at least 4 letters).",
    value: (f) => f.capsShare, sample: (f) => f.capsSample, minSample: 10, halfConfidenceAt: 20, reliability: 1,
    high: title("🔠", "The Caps Lock Incident", (c) => `${c.formatted} of letters in capitals`, (c) => `${c.formatted} of the letters ${c.name} types are CAPITALS — ${c.comparison}.`),
  },
  {
    id: "repeat_share", family: "chat", source: "LOG", unit: "ratio", transform: "logit", minSpread: 0.05, sensitive: "chat_style",
    formula: "Share of messages identical (ignoring case/spacing) to something they'd already said — compared by hash.",
    value: (f) => f.repeatShare, sample: (f) => f.chatMessages, minSample: 15, halfConfidenceAt: 25, reliability: 0.9,
    high: title("🤖", "The NPC", (c) => `${c.formatted} of messages are repeats`, (c) => `${c.formatted} of ${c.name}'s messages are something they've said before — ${c.comparison}. Dialogue tree: limited.`),
  },

  // ════════════════════════════ SOCIAL ════════════════════════════
  {
    id: "solo_share", family: "social", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of playtime with nobody else online.",
    value: (f) => f.soloShare, ...byHours(3), reliability: 0.95,
    high: title("🐺", "The Lone Wolf", (c) => `${c.formatted} of playtime alone`, (c) => `${c.name} spends ${c.formatted} of their time on the server completely alone — ${c.comparison}.`),
    low: title("🦋", "The Social Butterfly", (c) => `only ${c.formatted} of playtime alone`, (c) => `${c.name} is almost never online alone — just ${c.formatted} of their playtime, ${c.comparison}.`),
  },
  {
    id: "party_share", family: "social", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of playtime with three or more other players online.",
    value: (f) => f.partyShare, ...byHours(3), reliability: 0.95,
    high: title("🪩", "The Party Animal", (c) => `${c.formatted} of playtime with 3+ others`, (c) => `${c.formatted} of ${c.name}'s playtime is with at least three other people online — ${c.comparison}.`),
  },
  {
    id: "third_wheel", family: "social", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.06,
    formula: "Share of playtime with exactly two other players online.",
    value: (f) => f.thirdWheelShare, ...byHours(3), reliability: 0.95,
    high: title("🚲", "The Third Wheel", (c) => `${c.formatted} of playtime as the third player`, (c) => `${c.formatted} of ${c.name}'s playtime is spent with exactly two others — ${c.comparison}.`),
  },
  {
    id: "pack_animal", family: "social", source: "DERIVED", unit: "score", transform: "identity", minSpread: 0.4,
    formula: "Average number of other players online during their sessions (time-weighted).",
    value: (f) => f.avgOthersOnline, ...byHours(3), reliability: 0.95,
    high: title("🐑", "The Pack Animal", (c) => `${c.formatted} others online on average`, (c) => `When ${c.name} is online, ${c.formatted} other players are usually there too — ${c.comparison}.`),
  },
  {
    id: "server_couple", family: "social", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "The largest share of their playtime spent online with one specific other player.",
    value: (f) => f.topPartner?.share ?? null, ...byHours(3), reliability: 0.9,
    high: title("💞", "The Server Couple", (c) => `${c.formatted} of playtime with ${c.extra.partner}`, (c) => `${c.name} has been online with ${c.extra.partner} for ${c.formatted} of their playtime (${c.extra.together} together) — ${c.comparison}.`),
    extra: (f) => ({ partner: f.topPartner?.name ?? "someone", together: fmtDuration(f.topPartner?.seconds ?? 0) }),
  },
  {
    id: "fomo", family: "social", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.08,
    formula: "Share of their sessions that began within 10 minutes of another player joining.",
    value: (f) => f.fomoShare, ...bySessions(5), reliability: 0.9,
    high: title("📲", "The FOMO Merchant", (c) => `${c.formatted} of joins right after someone else`, (c) => `${c.formatted} of the time ${c.name} logs in, someone else joined in the previous 10 minutes — ${c.comparison}. Can't miss anything.`),
  },
  {
    id: "last_man_standing", family: "social", source: "DERIVED", unit: "count", transform: "log1p", minSpread: 2,
    formula: "Sessions where they had company, and were the last one left when they logged off.",
    value: (f) => f.lastManStanding, ...bySessions(3), reliability: 0.9,
    high: title("🕯️", "The Last Man Standing", (c) => `last one online ${c.times}`, (c) => `${c.name} has been the last person on the server ${c.times} — ${c.comparison}. Someone has to turn off the lights.`),
  },
  {
    id: "welcome_committee", family: "social", source: "DERIVED", unit: "count", transform: "log1p", minSpread: 3,
    formula: "Times another player joined while they were already online.",
    value: (f) => f.welcomeCommittee, ...bySessions(3), reliability: 0.9,
    high: title("👋", "The Welcome Committee", (c) => `already online for ${c.formatted} arrivals`, (c) => `${c.name} was already online to greet ${c.formatted} arrivals — ${c.comparison}.`),
  },
  {
    id: "host", family: "social", source: "DERIVED", unit: "ratio", transform: "logit", minSpread: 0.1,
    formula: "Share of their sessions where they were the first one online.",
    value: (f) => f.hostShare, ...bySessions(5), reliability: 0.9,
    high: title("🔑", "The Host", (c) => `first one online ${c.formatted} of the time`, (c) => `${c.name} opens the server ${c.formatted} of the time they play — ${c.comparison}.`),
  },
];

/**
 * Meta metrics are computed from the other metrics' z-scores (see engine.ts),
 * so they're defined separately. Their `value` reads a field the engine fills in.
 */
export interface MetaFeatures {
  statFreak: number | null;
  grind: number | null;
}

export const META_METRICS: readonly MetricDefinition<MetaFeatures & PlayerFeatures>[] = [
  {
    id: "statistical_freak", family: "meta", source: "DERIVED", unit: "score", transform: "identity", minSpread: 0.3,
    formula: "Mean of the player's five most extreme robust z-scores across every eligible metric.",
    value: (f) => f.statFreak, ...byHours(3), reliability: 0.8,
    high: title("🧪", "The Statistical Freak", () => `the most extreme numbers on the server`, (c) => `Across every statistic, ${c.name} has the most extreme numbers on the server (outlier score ${c.formatted}, ${c.comparison}).`),
  },
  {
    id: "grindset", family: "meta", source: "DERIVED", unit: "score", transform: "identity", minSpread: 0.3,
    formula: "Average z-score of mining rate, ore rate, hostile kill rate, distance rate and advancement rate (activity per hour).",
    value: (f) => f.grind, ...byStatsHours(3), reliability: 0.8,
    high: title("💪", "The Grindset", () => `the most productive hours on the server`, (c) => `Hour for hour, ${c.name} has the highest combined rate of mining, fighting, travelling and progressing on the server (activity score ${c.formatted}).`),
    low: title("🌴", "The Vibes-Only Player", () => `the most relaxed pace on the server`, (c) => `${c.name} plays at the most relaxed pace on the server — the lowest combined rate of mining, fighting, travelling and progressing (activity score ${c.formatted}). Pure vibes.`),
  },
];

/** Metrics feeding the "grindset" composite. */
export const GRIND_COMPONENTS = ["mining_rate", "ore_rate", "hostile_kill_rate", "distance_rate", "advancement_rate"] as const;

export const ALL_METRIC_IDS = [...METRICS, ...META_METRICS].map((m) => m.id);

