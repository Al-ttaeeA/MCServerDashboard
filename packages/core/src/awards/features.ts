import { deathCategory, type DeathCategory } from "../parser/death-messages";
import type { LogEvent } from "../parser/types";
import { forEachLocalHour } from "../stats/buckets";
import type { StatsSession } from "../stats/compute";
import { zonedParts } from "../time/zoned";
import { completedAt, type AdvancementProgress, type PlayerProfileData, type StatCategories } from "../world/world-files";

/**
 * Everything the award metrics need, computed once per player.
 *
 * Each field documents its source. `null` means the underlying data doesn't
 * exist for that player (e.g. no statistics file) — never a guessed zero.
 */

export interface AwardsInput {
  players: { key: string; uuid: string | null; name: string }[];
  /** Reconstructed sessions (LOG + DERIVED). */
  sessions: readonly StatsSession[];
  /** DEATH and CHAT events (others are ignored). */
  events: readonly { playerKey: string | null; ts: number; event: LogEvent }[];
  /** By lowercase UUID. */
  worldStats: ReadonlyMap<string, StatCategories>;
  worldAdvancements: ReadonlyMap<string, readonly AdvancementProgress[]>;
  profiles: ReadonlyMap<string, PlayerProfileData>;
  /** Community timezone for time-of-day metrics. */
  timeZone: string;
  now: number;
}

const HOUR = 3_600_000;
const MIN = 60_000;

/** Death categories that are "the world did it", not a mob or player. */
const ENVIRONMENTAL: ReadonlySet<DeathCategory> = new Set([
  "fall",
  "fire",
  "lava",
  "drowning",
  "suffocation",
  "starvation",
  "freezing",
  "void",
  "environment",
]);

/** Vanilla hostile mobs (for kill stats). Anything not here and not passive is ignored. */
export const HOSTILE_MOBS: ReadonlySet<string> = new Set([
  "zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "bogged", "wither_skeleton", "creeper",
  "spider", "cave_spider", "enderman", "witch", "slime", "magma_cube", "phantom", "blaze", "ghast", "hoglin",
  "zoglin", "piglin_brute", "pillager", "vindicator", "evoker", "ravager", "vex", "guardian", "elder_guardian",
  "shulker", "silverfish", "endermite", "breeze", "warden", "creaking", "wither", "ender_dragon", "piglin",
  "zombified_piglin",
]);

export const PASSIVE_MOBS: ReadonlySet<string> = new Set([
  "cow", "pig", "sheep", "chicken", "rabbit", "horse", "donkey", "mule", "llama", "trader_llama", "goat",
  "squid", "glow_squid", "salmon", "cod", "tropical_fish", "pufferfish", "turtle", "fox", "cat", "ocelot",
  "wolf", "parrot", "panda", "polar_bear", "bee", "mooshroom", "frog", "tadpole", "axolotl", "camel",
  "sniffer", "armadillo", "strider", "dolphin", "bat", "villager", "wandering_trader", "iron_golem",
  "snow_golem", "allay",
]);

/** Advancements that mark real progress, for speedrun / procrastinator. */
export const MILESTONES = [
  "story/smelt_iron",
  "story/mine_diamond",
  "story/enter_the_nether",
  "nether/find_fortress",
  "story/follow_ender_eye",
  "story/enter_the_end",
] as const;

export interface PlayerFeatures {
  key: string;
  name: string;
  uuid: string | null;

  // ── LOG + DERIVED: sessions ──
  playtimeH: number;
  sessionCount: number;
  longestSessionS: number;
  shortestSessionS: number;
  avgSessionS: number;
  sessionCV: number | null;
  longestGapH: number | null;
  activeDays: number;
  longestStreakDays: number;
  playtimePerActiveDayH: number | null;
  shortShare10: number | null;
  shortCount5: number;
  serverTimeShare: number | null;

  // ── DERIVED: schedule (community timezone) ──
  nightShare: number | null;
  morningShare: number | null;
  nineToFiveShare: number | null;
  afterSchoolShare: number | null;
  eveningShare: number | null;
  lunchShare: number | null;
  weekendShare: number | null;
  sundayNightShare: number | null;
  /** Median logout time, as hours after noon (so midnight = 12, 3 AM = 15). */
  typicalLogout: number | null;
  sunriseSessions: number;
  longestOvernightS: number;
  scheduleEntropy: number | null;

  // ── LOG: deaths ──
  deaths: number;
  envDeathShare: number | null;
  mobDeaths: number;
  fallDeaths: number;
  creeperDeaths: number;
  lavaFireDeaths: number;
  drowningDeaths: number;
  longestDeathlessH: number;
  maxDeathsInSession: number;
  shortestDeathGapS: number | null;

  // ── PLAYER_STATS (null when no statistics file) ──
  statsPlaytimeH: number | null;
  damageTakenHearts: number | null;
  blocksMined: number | null;
  deepslateShare: number | null;
  logsMined: number | null;
  diamondOre: number | null;
  oresMined: number | null;
  oreShare: number | null;
  toolsBroken: number | null;
  pickedUp: number | null;
  dropped: number | null;
  pickupDropRatio: number | null;
  crafted: number | null;
  containersOpened: number | null;
  distanceKm: number | null;
  sprintShare: number | null;
  swimKm: number | null;
  boatKm: number | null;
  fallKm: number | null;
  jumps: number | null;
  sneakShare: number | null;
  mobKills: number | null;
  hostileKills: number | null;
  passiveKills: number | null;
  spidersKilled: number | null;
  zombiesKilled: number | null;
  creepersKilled: number | null;
  mobTypesKilled: number | null;
  shieldBlocked: number | null;
  playerKills: number | null;
  trades: number | null;
  animalsBred: number | null;
  enchants: number | null;
  bedsSlept: number | null;

  // ── ADVANCEMENTS ──
  advancementsDone: number | null;
  biomesVisited: number | null;
  sideQuestCriteria: number | null;
  firstToCount: number | null;
  milestoneHours: number | null;
  milestoneCount: number;
  lateBloomerShare: number | null;
  historianSpread: number | null;

  // ── PLAYER_DATA ──
  xpLevel: number | null;
  seenCredits: number | null;

  // ── LOG: chat ──
  chatMessages: number;
  lateNightMessages: number;
  replies: number;
  avgMessageLength: number | null;
  capsShare: number | null;
  capsSample: number;
  repeatShare: number | null;

  // ── DERIVED: social (overlapping sessions) ──
  soloShare: number | null;
  partyShare: number | null;
  thirdWheelShare: number | null;
  avgOthersOnline: number | null;
  topPartner: { key: string; name: string; share: number; seconds: number } | null;
  fomoShare: number | null;
  lastManStanding: number;
  welcomeCommittee: number;
  hostShare: number | null;
}

export function computeFeatures(input: AwardsInput): Map<string, PlayerFeatures> {
  const { timeZone } = input;
  const byKey = new Map(input.players.map((p) => [p.key, p]));
  const sessionsBy = group(input.sessions, (s) => s.playerKey);
  for (const list of sessionsBy.values()) list.sort((a, b) => a.startTs - b.startTs);

  const deathsBy = new Map<string, { ts: number; cause: string; killer?: string; category: DeathCategory }[]>();
  const chats: { key: string; ts: number; length: number; capsShare: number | null; hash: string }[] = [];
  for (const e of input.events) {
    if (!e.playerKey) continue;
    if (e.event.type === "DEATH") {
      const list = deathsBy.get(e.playerKey) ?? [];
      list.push({ ts: e.ts, cause: e.event.cause, killer: e.event.killer, category: deathCategory(e.event.cause) });
      deathsBy.set(e.playerKey, list);
    } else if (e.event.type === "CHAT") {
      chats.push({
        key: e.playerKey,
        ts: e.ts,
        length: e.event.length ?? 0,
        capsShare: e.event.capsShare ?? null,
        hash: e.event.hash ?? "",
      });
    }
  }
  chats.sort((a, b) => a.ts - b.ts);

  const social = computeSocial(input.sessions, byKey);
  const serverOnlineMs = unionLength(input.sessions);
  const firstCompletion = firstCompletionTimes(input.worldAdvancements);
  const lifespanStart = Math.min(...input.sessions.map((s) => s.startTs), input.now);

  const out = new Map<string, PlayerFeatures>();
  for (const player of input.players) {
    const sessions = sessionsBy.get(player.key) ?? [];
    const durations = sessions.map((s) => (s.endTs - s.startTs) / 1000);
    const playtimeS = sum(durations);
    const playtimeH = playtimeS / 3600;

    // Schedule: walk each session in local-hour slices.
    const days = new Set<string>();
    let night = 0, morning = 0, nineToFive = 0, afterSchool = 0, evening = 0, lunch = 0, weekend = 0, sundayNight = 0;
    for (const s of sessions) {
      forEachLocalHour(s.startTs, s.endTs, timeZone, (sl) => {
        days.add(sl.date);
        const h = sl.hour;
        if (h < 6) night += sl.seconds;
        else if (h < 12) morning += sl.seconds;
        if (h >= 15 && h < 19) afterSchool += sl.seconds;
        if (h >= 19) evening += sl.seconds;
        if (sl.weekday < 5 && h >= 9 && h < 17) nineToFive += sl.seconds;
        if (sl.weekday >= 5) weekend += sl.seconds;
        if (sl.weekday === 6 && h >= 18) sundayNight += sl.seconds;
        lunch += overlap(h * 3600 + sl.startSecond, h * 3600 + sl.startSecond + sl.seconds, 11.5 * 3600, 13.5 * 3600);
      });
    }
    const share = (x: number) => (playtimeS > 0 ? x / playtimeS : null);

    const sortedDays = [...days].sort();
    let streak = 0, best = 0;
    for (let i = 0; i < sortedDays.length; i++) {
      streak = i > 0 && dayDiff(sortedDays[i - 1]!, sortedDays[i]!) === 1 ? streak + 1 : 1;
      best = Math.max(best, streak);
    }

    const gaps = sessions.slice(1).map((s, i) => (s.startTs - sessions[i]!.endTs) / HOUR);
    const logouts = sessions.map((s) => clockAfterNoon(s.endTs, timeZone));
    const startHours = sessions.map((s) => zonedParts(s.startTs, timeZone).hour);
    let sunrise = 0, overnight = 0;
    for (const s of sessions) {
      if (crossesLocalTime(s.startTs, s.endTs, timeZone, 6)) sunrise++;
      if (crossesLocalTime(s.startTs, s.endTs, timeZone, 0)) overnight = Math.max(overnight, (s.endTs - s.startTs) / 1000);
    }

    // Deaths.
    const deaths = (deathsBy.get(player.key) ?? []).sort((a, b) => a.ts - b.ts);
    const deathTimes = deaths.map((d) => d.ts);
    let maxInSession = 0;
    for (const s of sessions) maxInSession = Math.max(maxInSession, deathTimes.filter((t) => t >= s.startTs && t <= s.endTs).length);
    const boundaries = [-Infinity, ...deathTimes, Infinity];
    let deathless = 0;
    for (let i = 1; i < boundaries.length; i++) deathless = Math.max(deathless, playtimeBetween(sessions, boundaries[i - 1]!, boundaries[i]!));
    const deathGaps = deathTimes.slice(1).map((t, i) => (t - deathTimes[i]!) / 1000);

    // World statistics.
    const ws = player.uuid ? input.worldStats.get(player.uuid) : undefined;
    const w = ws ? worldFeatures(ws) : null;

    // Advancements.
    const adv = player.uuid ? input.worldAdvancements.get(player.uuid) : undefined;
    const a = adv ? advancementFeatures(adv, player.uuid!, firstCompletion, sessions, lifespanStart, input.now) : null;

    const profile = player.uuid ? input.profiles.get(player.uuid) : undefined;

    // Chat.
    const mine = chats.filter((c) => c.key === player.key);
    let replies = 0;
    for (let i = 1; i < chats.length; i++) {
      const c = chats[i]!;
      if (c.key !== player.key) continue;
      // Most recent message from someone else within 20 s.
      for (let j = i - 1; j >= 0 && c.ts - chats[j]!.ts <= 20_000; j--) {
        if (chats[j]!.key !== player.key) {
          replies++;
          break;
        }
      }
    }
    const seen = new Set<string>();
    let repeats = 0;
    for (const c of mine) {
      if (seen.has(c.hash)) repeats++;
      seen.add(c.hash);
    }
    const caps = mine.map((c) => c.capsShare).filter((x): x is number => x !== null);

    const soc = social.get(player.key);

    out.set(player.key, {
      key: player.key,
      name: player.name,
      uuid: player.uuid,

      playtimeH,
      sessionCount: sessions.length,
      longestSessionS: Math.max(0, ...durations),
      shortestSessionS: durations.length ? Math.min(...durations) : 0,
      avgSessionS: sessions.length ? playtimeS / sessions.length : 0,
      sessionCV: durations.length >= 2 ? std(durations) / (mean(durations) || 1) : null,
      longestGapH: gaps.length ? Math.max(...gaps) : null,
      activeDays: days.size,
      longestStreakDays: best,
      playtimePerActiveDayH: days.size ? playtimeH / days.size : null,
      shortShare10: sessions.length ? durations.filter((d) => d < 600).length / sessions.length : null,
      shortCount5: durations.filter((d) => d < 300).length,
      serverTimeShare: serverOnlineMs > 0 ? (playtimeS * 1000) / serverOnlineMs : null,

      nightShare: share(night),
      morningShare: share(morning),
      nineToFiveShare: share(nineToFive),
      afterSchoolShare: share(afterSchool),
      eveningShare: share(evening),
      lunchShare: share(lunch),
      weekendShare: share(weekend),
      sundayNightShare: share(sundayNight),
      typicalLogout: logouts.length ? median(logouts) : null,
      sunriseSessions: sunrise,
      longestOvernightS: overnight,
      scheduleEntropy: startHours.length >= 2 ? normalisedEntropy(startHours) : null,

      deaths: deaths.length,
      envDeathShare: deaths.length ? deaths.filter((d) => ENVIRONMENTAL.has(d.category)).length / deaths.length : null,
      mobDeaths: deaths.filter((d) => d.category === "mob" || d.category === "projectile").length,
      fallDeaths: deaths.filter((d) => d.category === "fall").length,
      creeperDeaths: deaths.filter((d) => d.killer === "Creeper").length,
      lavaFireDeaths: deaths.filter((d) => d.category === "lava" || d.category === "fire").length,
      drowningDeaths: deaths.filter((d) => d.category === "drowning").length,
      longestDeathlessH: deathless / 3600,
      maxDeathsInSession: maxInSession,
      shortestDeathGapS: deathGaps.length ? Math.min(...deathGaps) : null,

      statsPlaytimeH: w?.playtimeH ?? null,
      damageTakenHearts: w?.damageTakenHearts ?? null,
      blocksMined: w?.blocksMined ?? null,
      deepslateShare: w && w.blocksMined > 0 ? w.deepslate / w.blocksMined : null,
      logsMined: w?.logs ?? null,
      diamondOre: w?.diamondOre ?? null,
      oresMined: w?.ores ?? null,
      oreShare: w && w.blocksMined > 0 ? w.ores / w.blocksMined : null,
      toolsBroken: w?.toolsBroken ?? null,
      pickedUp: w?.pickedUp ?? null,
      dropped: w?.dropped ?? null,
      pickupDropRatio: w ? w.pickedUp / (w.dropped + 1) : null,
      crafted: w?.crafted ?? null,
      containersOpened: w?.containers ?? null,
      distanceKm: w?.distanceKm ?? null,
      sprintShare: w && w.distanceKm > 0 ? w.sprintKm / w.distanceKm : null,
      swimKm: w?.swimKm ?? null,
      boatKm: w?.boatKm ?? null,
      fallKm: w?.fallKm ?? null,
      jumps: w?.jumps ?? null,
      sneakShare: w && w.playtimeH > 0 ? w.sneakH / w.playtimeH : null,
      mobKills: w?.mobKills ?? null,
      hostileKills: w?.hostileKills ?? null,
      passiveKills: w?.passiveKills ?? null,
      spidersKilled: w?.spiders ?? null,
      zombiesKilled: w?.zombies ?? null,
      creepersKilled: w?.creepers ?? null,
      mobTypesKilled: w?.mobTypes ?? null,
      shieldBlocked: w?.shieldBlocked ?? null,
      playerKills: w?.playerKills ?? null,
      trades: w?.trades ?? null,
      animalsBred: w?.bred ?? null,
      enchants: w?.enchants ?? null,
      bedsSlept: w?.beds ?? null,

      advancementsDone: a?.done ?? null,
      biomesVisited: a?.biomes ?? null,
      sideQuestCriteria: a?.sideQuest ?? null,
      firstToCount: a?.firstTo ?? null,
      milestoneHours: a?.milestoneHours ?? null,
      milestoneCount: a?.milestoneCount ?? 0,
      lateBloomerShare: a?.lateShare ?? null,
      historianSpread: a?.spread ?? null,

      xpLevel: profile?.xpLevel ?? null,
      seenCredits: profile ? (profile.seenCredits ? 1 : 0) : null,

      chatMessages: mine.length,
      lateNightMessages: mine.filter((c) => zonedParts(c.ts, timeZone).hour < 6).length,
      replies,
      avgMessageLength: mine.length ? mean(mine.map((c) => c.length)) : null,
      capsShare: caps.length ? mean(caps) : null,
      capsSample: caps.length,
      repeatShare: mine.length ? repeats / mine.length : null,

      soloShare: soc && playtimeS > 0 ? soc.solo / playtimeS : null,
      partyShare: soc && playtimeS > 0 ? soc.threePlus / playtimeS : null,
      thirdWheelShare: soc && playtimeS > 0 ? soc.exactlyTwo / playtimeS : null,
      avgOthersOnline: soc && playtimeS > 0 ? soc.othersWeighted / playtimeS : null,
      topPartner: soc?.topPartner && playtimeS > 0 ? { ...soc.topPartner, share: soc.topPartner.seconds / playtimeS } : null,
      fomoShare: soc && sessions.length ? soc.fomoJoins / sessions.length : null,
      lastManStanding: soc?.lastMan ?? 0,
      welcomeCommittee: soc?.welcomed ?? 0,
      hostShare: soc && sessions.length ? soc.hosted / sessions.length : null,
    });
  }
  return out;
}

// ── World statistics ────────────────────────────────────────────────────

function worldFeatures(s: StatCategories) {
  const cat = (c: string) => s[c] ?? {};
  const custom = cat("custom");
  const total = (c: string, pred: (k: string) => boolean = () => true) =>
    Object.entries(cat(c)).reduce((acc, [k, v]) => (pred(k) ? acc + v : acc), 0);
  const cm = (k: string) => custom[k] ?? 0;
  const distanceCm = Object.entries(custom).reduce((acc, [k, v]) => (k.endsWith("_one_cm") && k !== "fall_one_cm" ? acc + v : acc), 0);
  const killed = cat("killed");
  const ticksPerHour = 72_000;
  return {
    playtimeH: cm("play_time") / ticksPerHour,
    // damage stats are stored ×10 in half-hearts → /20 = hearts.
    damageTakenHearts: cm("damage_taken") / 20,
    blocksMined: total("mined"),
    deepslate: total("mined", (k) => k.includes("deepslate") || k === "tuff"),
    logs: total("mined", (k) => /_(log|stem|wood|hyphae)$/.test(k)),
    diamondOre: total("mined", (k) => k === "diamond_ore" || k === "deepslate_diamond_ore"),
    ores: total("mined", (k) => k.endsWith("_ore") || k === "ancient_debris"),
    toolsBroken: total("broken"),
    pickedUp: total("picked_up"),
    dropped: total("dropped"),
    crafted: total("crafted"),
    containers: cm("open_chest") + cm("open_barrel") + cm("open_shulker_box") + cm("open_enderchest"),
    distanceKm: distanceCm / 100_000,
    sprintKm: cm("sprint_one_cm") / 100_000,
    swimKm: (cm("swim_one_cm") + cm("walk_under_water_one_cm")) / 100_000,
    boatKm: cm("boat_one_cm") / 100_000,
    fallKm: cm("fall_one_cm") / 100_000,
    jumps: cm("jump"),
    sneakH: cm("sneak_time") / ticksPerHour,
    mobKills: cm("mob_kills"),
    hostileKills: Object.entries(killed).reduce((acc, [k, v]) => (HOSTILE_MOBS.has(k) ? acc + v : acc), 0),
    passiveKills: Object.entries(killed).reduce((acc, [k, v]) => (PASSIVE_MOBS.has(k) ? acc + v : acc), 0),
    spiders: (killed.spider ?? 0) + (killed.cave_spider ?? 0),
    zombies: (killed.zombie ?? 0) + (killed.husk ?? 0) + (killed.drowned ?? 0) + (killed.zombie_villager ?? 0),
    creepers: killed.creeper ?? 0,
    mobTypes: Object.values(killed).filter((v) => v > 0).length,
    shieldBlocked: cm("damage_blocked_by_shield") / 20,
    playerKills: cm("player_kills"),
    trades: cm("traded_with_villager"),
    bred: cm("animals_bred"),
    enchants: cm("enchant_item"),
    beds: Object.entries(custom).reduce((acc, [k, v]) => (k.startsWith("sleep_in_") ? acc + v : acc), 0),
  };
}

// ── Advancements ────────────────────────────────────────────────────────

const isRoot = (id: string) => id.endsWith("/root");

function firstCompletionTimes(all: ReadonlyMap<string, readonly AdvancementProgress[]>): Map<string, { uuid: string; ts: string }> {
  const first = new Map<string, { uuid: string; ts: string }>();
  for (const [uuid, list] of all) {
    for (const a of list) {
      const ts = completedAt(a);
      if (!ts || isRoot(a.id)) continue;
      const cur = first.get(a.id);
      if (!cur || ts < cur.ts) first.set(a.id, { uuid, ts });
    }
  }
  return first;
}

function advancementFeatures(
  list: readonly AdvancementProgress[],
  uuid: string,
  first: Map<string, { uuid: string; ts: string }>,
  sessions: readonly StatsSession[],
  lifespanStart: number,
  now: number,
) {
  const done = list.filter((a) => a.done && !isRoot(a.id));
  const doneTimes = done.map((a) => Date.parse(completedAt(a)!)).sort((x, y) => x - y);
  const biomes = list.find((a) => a.id === "adventure/adventuring_time");
  const sideQuest = list.filter((a) => Object.keys(a.criteria).length >= 5 || ["adventure/adventuring_time", "husbandry/balanced_diet", "adventure/kill_all_mobs", "husbandry/bred_all_animals"].includes(a.id));
  const totalPlay = playtimeBetween(sessions, -Infinity, Infinity);
  const milestoneHours: number[] = [];
  for (const id of MILESTONES) {
    const a = done.find((x) => x.id === id);
    if (a) milestoneHours.push(playtimeBetween(sessions, -Infinity, Date.parse(completedAt(a)!)) / 3600);
  }
  const lateShare =
    doneTimes.length && totalPlay > 0
      ? doneTimes.filter((t) => playtimeBetween(sessions, -Infinity, t) > totalPlay / 2).length / doneTimes.length
      : null;
  return {
    done: done.length,
    biomes: biomes ? Object.keys(biomes.criteria).length : 0,
    sideQuest: sum(sideQuest.map((a) => Object.keys(a.criteria).length)),
    firstTo: done.filter((a) => first.get(a.id)?.uuid === uuid).length,
    milestoneHours: milestoneHours.length ? mean(milestoneHours) : null,
    milestoneCount: milestoneHours.length,
    lateShare,
    spread: doneTimes.length >= 2 && now > lifespanStart ? (doneTimes.at(-1)! - doneTimes[0]!) / (now - lifespanStart) : null,
  };
}

// ── Social ──────────────────────────────────────────────────────────────

interface SocialTotals {
  solo: number;
  threePlus: number;
  exactlyTwo: number;
  othersWeighted: number;
  topPartner: { key: string; name: string; seconds: number } | null;
  fomoJoins: number;
  lastMan: number;
  welcomed: number;
  hosted: number;
}

/**
 * One sweep over every session boundary. Between two boundaries the set of
 * online players is constant, so each segment's duration is credited to
 * everyone online with "how many others were here".
 */
function computeSocial(
  sessions: readonly StatsSession[],
  players: Map<string, { name: string }>,
): Map<string, SocialTotals> {
  const totals = new Map<string, SocialTotals>();
  const pair = new Map<string, Map<string, number>>();
  const get = (k: string) => {
    let t = totals.get(k);
    if (!t) totals.set(k, (t = { solo: 0, threePlus: 0, exactlyTwo: 0, othersWeighted: 0, topPartner: null, fomoJoins: 0, lastMan: 0, welcomed: 0, hosted: 0 }));
    return t;
  };

  const points: { t: number; delta: 1 | -1; key: string }[] = [];
  for (const s of sessions) {
    if (s.endTs <= s.startTs) continue;
    points.push({ t: s.startTs, delta: 1, key: s.playerKey }, { t: s.endTs, delta: -1, key: s.playerKey });
  }
  points.sort((a, b) => a.t - b.t || a.delta - b.delta);
  const online = new Map<string, number>(); // key → count (defensive against overlaps)
  let prevT: number | null = null;
  for (const p of points) {
    if (prevT !== null && p.t > prevT && online.size > 0) {
      const dur = (p.t - prevT) / 1000;
      const keys = [...online.keys()];
      for (const k of keys) {
        const t = get(k);
        const others = keys.length - 1;
        if (others === 0) t.solo += dur;
        if (others >= 3) t.threePlus += dur;
        if (others === 2) t.exactlyTwo += dur;
        t.othersWeighted += others * dur;
        for (const o of keys) {
          if (o === k) continue;
          let m = pair.get(k);
          if (!m) pair.set(k, (m = new Map()));
          m.set(o, (m.get(o) ?? 0) + dur);
        }
      }
    }
    if (p.delta === 1) online.set(p.key, (online.get(p.key) ?? 0) + 1);
    else {
      const c = (online.get(p.key) ?? 1) - 1;
      if (c <= 0) online.delete(p.key);
      else online.set(p.key, c);
    }
    prevT = p.t;
  }

  // Join-relative behaviours.
  const sorted = [...sessions].sort((a, b) => a.startTs - b.startTs);
  const isOnline = (key: string, t: number, excludeStart = false) =>
    sorted.some((s) => s.playerKey === key && s.startTs <= t && s.endTs > t && !(excludeStart && s.startTs === t));
  for (const s of sorted) {
    const others = sorted.filter((o) => o.playerKey !== s.playerKey);
    const anyoneOnlineAtStart = others.some((o) => o.startTs < s.startTs && o.endTs > s.startTs);
    if (!anyoneOnlineAtStart) get(s.playerKey).hosted++;
    // FOMO: joined within 10 minutes of someone else joining (who's still online).
    if (others.some((o) => o.startTs < s.startTs && s.startTs - o.startTs <= 10 * MIN && o.endTs > s.startTs)) get(s.playerKey).fomoJoins++;
    // Welcome committee: everyone already online when this player joins.
    for (const o of others) if (o.startTs < s.startTs && o.endTs > s.startTs) get(o.playerKey).welcomed++;
    // Last man standing: someone else was here during the session, and nobody was left when they logged off.
    const hadCompany = others.some((o) => o.startTs < s.endTs && o.endTs > s.startTs);
    const othersAfter = others.some((o) => o.startTs <= s.endTs && o.endTs > s.endTs);
    if (hadCompany && !othersAfter && !isOnline(s.playerKey, s.endTs, true)) get(s.playerKey).lastMan++;
  }

  for (const [k, m] of pair) {
    let best: { key: string; name: string; seconds: number } | null = null;
    for (const [o, sec] of m) if (!best || sec > best.seconds) best = { key: o, name: players.get(o)?.name ?? o, seconds: sec };
    get(k).topPartner = best;
  }
  return totals;
}

// ── helpers ─────────────────────────────────────────────────────────────

export function playtimeBetween(sessions: readonly StatsSession[], from: number, to: number): number {
  let s = 0;
  for (const x of sessions) s += Math.max(0, Math.min(x.endTs, to) - Math.max(x.startTs, from));
  return s / 1000;
}

function unionLength(sessions: readonly StatsSession[]): number {
  const sorted = [...sessions].sort((a, b) => a.startTs - b.startTs);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const s of sorted) {
    if (s.startTs > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s.startTs;
      curEnd = s.endTs;
    } else curEnd = Math.max(curEnd, s.endTs);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

function clockAfterNoon(ts: number, tz: string): number {
  const p = zonedParts(ts, tz);
  return (p.hour + p.minute / 60 - 12 + 24) % 24;
}

/** Does [start, end) contain a local time-of-day `hour`:00? */
function crossesLocalTime(start: number, end: number, tz: string, hour: number): boolean {
  if (end - start >= 24 * HOUR) return true;
  let crossed = false;
  forEachLocalHour(start, end, tz, (sl) => {
    if (sl.hour === hour && sl.startSecond === 0 && sl.seconds > 0) crossed = true;
  });
  return crossed;
}

function normalisedEntropy(hours: number[]): number {
  const counts = new Map<number, number>();
  for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1);
  let e = 0;
  for (const c of counts.values()) {
    const p = c / hours.length;
    e -= p * Math.log2(p);
  }
  const max = Math.log2(Math.min(24, hours.length));
  return max > 0 ? e / max : 0;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function group<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    const l = m.get(k);
    if (l) l.push(i);
    else m.set(k, [i]);
  }
  return m;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : 0);
function std(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
