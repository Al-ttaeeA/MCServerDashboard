# Statistics

All statistics are computed **at sync time** (`packages/core/src/stats/compute.ts`),
in TypeScript on the GitHub Actions runner. They're stored as JSON in
`smp.player_stats` and `smp.server_stats`. The API Worker returns them without
computing anything, which keeps it inside Cloudflare's free-tier limit of 10 ms CPU
per request.

## Time zones

| Where | Timezone |
|---|---|
| Log timestamps | Server time (`SERVER_LOG_TIMEZONE`, UTC) |
| Database | UTC (`timestamptz`) |
| "Per day" / "per hour" stats | The community timezone (`STATS_TIMEZONE`, `America/New_York`) |
| Timeline, session times | The viewer's own timezone (browser) |

Daily buckets use one fixed community timezone so that "Saturday" means the same
day for everyone. Sessions are split at local hour boundaries, which makes this
DST-safe: a session from 23:30 to 01:15 counts 30 minutes toward one day and
75 minutes toward the next.

## Player statistics

| Stat | How it's calculated | Kind |
|---|---|---|
| Total playtime | Sum of session durations | derived |
| Sessions, average, median, longest | From session durations | derived |
| First / last seen | Earliest / latest session or event | derived |
| Active days | Days with any playtime (community timezone) | derived |
| Longest / current streak | Consecutive active days; "current" counts if the last active day was today or yesterday | derived |
| Daily / hourly / weekday playtime | Sessions split at local hour boundaries | derived |
| Night-owl share | Share of playtime between 00:00 and 05:59 local | derived |
| Favourite hour | The hour of day with the most playtime | derived |
| Deaths | Count of death messages | observed |
| Deaths by category / cause, nemesis | Grouped by death template / killer name | observed |
| Deaths per hour | Deaths ÷ hours played (hidden under 1 h of playtime) | derived |
| Advancements | First time each advancement was announced, split into advancement / goal / challenge | observed |
| Chat messages, per hour | Count of chat lines (content is never stored) | observed |
| Plays most with | Player with the largest total overlap of online time | derived |
| Estimated-end share | Share of sessions ending by crash, inferred leave or still open | derived |

**Server statistics:** total playtime, player count, peak concurrent players (a sweep
over session boundaries), busiest day, daily and hourly totals, deaths, advancements,
chat count, server runs and crashes, and Minecraft versions seen.

## Highlights ("3 significant stats")

The timeline popover shows three highlighted stats per player, stored in
`player_stats.highlights` during sync.

**Current state: placeholder.** `pickHighlights()` in `stats/registry.ts` returns a
fixed preference order: longest session, deaths, advancements.

The foundation for the real algorithm is already in place:
- **`STAT_DEFINITIONS`** is a registry of comparable stats. Each entry says how to read
  its value, its unit, and whether high, low or both are notable.
- **`pickHighlights()`** already receives every player's stats, so it can compare one
  player against the server.
- **It runs at sync time**, so a heavier algorithm costs nothing at request time.

The population-relative significance scoring (percentiles, robust deviation,
reliability weighting) will replace the placeholder body without changing any callers.
