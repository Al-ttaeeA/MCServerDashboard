# Log parser & ingestion

How vanilla Minecraft server logs become database rows. The code lives in
`packages/core/src/parser`, `packages/core/src/sessions` and `packages/ingest`.

## Log files on the server

Vanilla's logging config (log4j2) writes:

| File | Meaning |
|---|---|
| `logs/latest.log` | The file currently being written |
| `logs/YYYY-MM-DD-N.log.gz` | A finished file, gzipped. `N` counts files rotated that day |

Rotation happens **when the server starts** and **on the first line written after
midnight** (server time). So a file never spans two calendar days, and the date in
its name is the day its lines were written. Confirmed on our server: files rotate at
midnight UTC even without a restart.

Each line looks like this:

```
[03:33:13] [Server thread/INFO]: System chat: adufaru123 joined the game
 └ time     └ thread / level     └ message
```

Timestamps have **no date and no timezone**. The date comes from the filename
(`latest.log` gets its date from its modification time). The timezone comes from
`SERVER_LOG_TIMEZONE`, which is `UTC` on WiseHosting.

Since Minecraft 26.x, broadcast messages start with `System chat: `. The parser
accepts messages with or without that prefix.

## Recognized events

Every event below is **directly observed**: it comes from a single log line.

| Event | Example line (message part) | Stored data |
|---|---|---|
| `SERVER_START` | `Starting minecraft server version 26.3` | version |
| `SERVER_READY` | `Done (2.591s)! For help, type "help"` | startup seconds |
| `SERVER_STOP` | `Stopping server` | — |
| `SERVER_PAUSE` | `Server empty for 60 seconds, pausing` | — |
| `PLAYER_UUID` | `UUID of player Steve is 069a79f4-…` | name, UUID |
| `PLAYER_LOGIN` | `Steve[/1.2.3.4:5678] logged in with entity id 25 at (13.5, 97.0, -53.5)` | name, x/y/z. **The IP is dropped** |
| `JOIN` | `Steve joined the game` / `Steve (formerly known as Old) joined the game` | name, former name |
| `LEAVE` | `Steve left the game` | name |
| `DISCONNECT` | `Steve lost connection: Timed out` | name, reason |
| `DEATH` | `Steve was slain by Zombie using [Iron Sword]` | message, cause key, killer, weapon, category |
| `ADVANCEMENT` | `Steve has made the advancement [Stone Age]` (also `completed the challenge`, `reached the goal`) | name, kind |
| `CHAT` | `<Steve> hello` | **name only, never the message** |

Some lines are recognized on purpose and then **ignored**:
- Pre-login disconnects (`Steve (/1.2.3.4) lost connection`) and whitelist kicks. These people never actually played.
- Ordinary noise such as chunk saves, "moved too quickly" warnings, and stack traces.

### Death messages

Vanilla logs the English text of each death broadcast. `death-messages.ts` holds
the full catalog of `death.*` templates from the game's language file, for
example `%1$s was slain by %2$s`. Each template is compiled into a matcher, and
matchers are tried most-specific first.

A death only counts when the victim is a player who has actually logged in. That
stops a system message from being mistaken for a death just because its first word
looks like a name.

### Parser architecture

1. **`tokenize.ts`** splits the header by position and delimiter instead of using one
   large regex, so thread names containing spaces or `#` still work. It also accepts
   the older `[HH:MM:SS LEVEL]:` layout.
2. **`matchers.ts`** is an ordered list of small matchers. To support a new message,
   or a format change after a Minecraft update, add a matcher there.
3. **`parse-log.ts`** runs the matchers over a whole file and records anything it
   couldn't understand.

### Parse issues (never silently dropped)

| Reason | When |
|---|---|
| `malformed_line` | No `[HH:MM:SS] [...]` header and not a stack-trace continuation |
| `unrecognized_player_message` | A broadcast about a known player that no matcher understood. Almost always a new death message after an update |
| `time_went_backwards` | Time jumped back more than 1 hour inside one file, which we treat as an unexpected midnight rollover |

Issues are stored in `smp.parse_issues`, with IP addresses redacted, and counted in
the sync output. One bad line never stops an import.

## Identity: UUIDs and renames

The server logs `UUID of player X is …` right before every login (`online-mode=true`
gives real Mojang UUIDs), so players are keyed by UUID:
- **A rename** keeps the same UUID under a new name. Old names are kept in `smp.player_names`.
- **A name with no UUID ever seen** gets a provisional `name:<name>` key, which can be reconciled later.
- **A UUID line alone doesn't create a player**, because the whitelist may reject them.

## Sessions

`buildSessions()` is a **pure function** over the full, time-ordered event history.
It runs on every sync, so sessions can never drift out of step with events.

| Situation | Result | `end_reason` |
|---|---|---|
| `joined` … `left` | Normal session | `leave` |
| `Stopping server` while online | Closed at the stop line | `server_stop` |
| `Starting minecraft server` while sessions are still open (crash or kill) | Closed at the **last log line before the crash**, the best estimate available | `crash` *(estimated)* |
| `Server empty for 60 seconds` while someone is still marked online | Closed 60 s before that line | `inferred_empty` *(estimated)* |
| A second `joined` without a `left` | First session closed at the second join, so sessions never overlap | `rejoin` |
| Still online at the end of the logs | Open, ending at the last observed line | `open` |
| A `left` with no matching `joined` | Ignored | — |

Sessions that cross midnight span two files and are still one session. The timeline
draws estimated ends with a fade, and live sessions are extended to "now".

## Idempotency: running twice never duplicates

- **Event key:** each event's unique key is `(log_file_id, line_no)`, and inserts use
  `ON CONFLICT DO NOTHING`.
- **File identity:** a log run is identified by `log date + sha256(first line)`.
  `latest.log` and the `.gz` it later becomes share this fingerprint, so the `.gz` is
  recognized and only lines past the stored offset are imported.
- **Skipping finished files:** completed `.gz` files are skipped by name and size
  without even being downloaded.
- **A half-written last line** of `latest.log` is ignored until it's complete.
- **Re-dating:** if `latest.log`'s date was guessed wrong, the `.gz` reveals the real
  date, and that file's events are re-imported with corrected timestamps.
- **Transactions:** each file's events and progress are written in one transaction.
  Derived tables (players, sessions, runs, stats) are rebuilt together in another,
  so readers never see a half-finished state.

`npm run sync -- --reparse` re-parses every file still on the server. Use it after
adding a matcher, so lines that were previously unrecognized get picked up.

## What the logs can and can't tell us

**Directly observed:** joins and leaves, login coordinates, disconnect reasons, deaths
(cause, killer, weapon), advancements (only when announced), chat *counts*, server
starts, stops and version.

**Derived** (calculated from the above): sessions, playtime (total, daily, hourly,
weekday), session length stats, active days and streaks, night-owl share, peak
concurrency, "plays most with", deaths per hour, crash count.

**Not available from vanilla logs:**
- blocks mined or placed, items crafted or used
- mob kills (only *player* deaths are broadcast)
- distance travelled, jumps
- damage dealt or taken
- time spent in each dimension
- commands players ran (vanilla doesn't log them)
- AFK time
- advancements earned before logging began, or while `announceAdvancements` was off

Most of these exist in `world/stats/<uuid>.json` and `world/advancements/<uuid>.json`,
which a later phase may read over the same SFTP connection.
