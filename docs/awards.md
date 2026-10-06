# Awards: statistics and the significance algorithm

Every player gets up to **three awards**: playful titles like *The Night Shift* or *The Diamond Goblin*. They're chosen automatically by comparing each player with the rest of the server. Each award can go to **only one player**, and the whole server's set of awards is optimised together.

The code lives in `packages/core/src/awards/`.

| File | Purpose |
|---|---|
| `features.ts` | Every number the metrics need, computed once per player |
| `catalog.ts` | The metric catalog: sources, formulas, titles, explanation templates |
| `significance.ts` | Scores how remarkable each player is for each metric |
| `allocate.ts` | Global assignment (min-cost flow) |
| `engine.ts` | Ties it together; produces awards, records and debug data |
| `config.ts` | Switches for sensitive categories and individual awards |

Awards are computed during each sync (GitHub Actions, no CPU limits) and stored in `smp.player_stats.awards` and `smp.awards_snapshot`. The website only reads them.

## 1. Data sources

All of these were verified on our server (Minecraft 26.3, DataVersion 5023) before any metric used them.

| Source | Where | What we use |
|---|---|---|
| `LOG` | `logs/latest.log`, `logs/*.log.gz` | Sessions, deaths (cause, killer), chat counts and per-message *features* (length, share of capitals, repeat hash; never text), server starts and stops |
| `PLAYER_STATS` | `world/players/stats/<uuid>.json` | Vanilla statistics: play time, blocks mined, items crafted, picked up, dropped and broken, mobs killed, distances, jumps, sneak time, damage, trades, breeding, enchanting, sleeping |
| `ADVANCEMENTS` | `world/players/advancements/<uuid>.json` | Completed advancements and **per-criterion timestamps**: biomes visited, mob types hunted, foods eaten… Recipe unlocks are dropped |
| `PLAYER_DATA` | `world/players/data/<uuid>.dat` (gzipped NBT) | Only `XpLevel`, `XpTotal` and `seenCredits` (dragon beaten). **Position, inventory and ender chest are never read into the database**: the site is public and positions would reveal bases |
| `DERIVED` | Computed from the above | Session patterns, time-of-day shares, social overlap, rates per hour, composites |

Facts that shape the metrics:
- **A statistics key only exists once its value is non-zero**, so a missing key means 0.
  - That's why `player_kills` (The Bloodhound) is defined but has no data yet.
- **Statistics files are running totals with no timestamps.** Anything time-of-day comes from the log instead.
- **Statistics and logs agree:** death totals in the stats files exactly match the log's death messages.
- **The folder layout changed in 26.1.** The ingester reads `level-name` from `server.properties`, tries `<world>/players/{stats,advancements,data}` first, and falls back to the pre-26.1 `<world>/{stats,advancements,playerdata}`.

## 2. How a metric is defined

```ts
interface MetricDefinition<F> {
  id; family; source;        // e.g. "night_share", "schedule", "DERIVED"
  formula: string;           // shown in docs and the debug view
  unit; transform;           // display unit; log1p | logit | identity
  minSpread: number;         // smallest meaningful difference (raw units)
  value(f): number | null;   // null = data doesn't exist → not eligible
  sample(f): number;         // what the value is based on (hours, sessions, deaths…)
  minSample; halfConfidenceAt;
  reliability: number;       // 0..1
  high?: AwardTitle;         // e.g. 🏠 The Resident
  low?: AwardTitle;          // e.g. 🌱 The Touch Grass Award
  sensitive?: "deaths" | "short_sessions" | "schedule" | "chat_volume" | "chat_style";
}
```

**One metric, at most one award.** A metric can carry a HIGH title, a LOW title, or both. Total playtime, for example, has *The Resident* (high) and *The Touch Grass Award* (low). The uniqueness constraint applies **per metric**, so at most one of those two can ever be awarded. Whichever extreme scores higher wins.

**Adding an award** means adding one object to `catalog.ts`. If it needs a new number, add a field to `features.ts`.

## 3. Significance

For metric *m* and each eligible player *i*:

1. **Eligibility.** The value must exist and `sample ≥ minSample`; otherwise the player is NOT ELIGIBLE for that metric. A metric with fewer than **3** eligible players is skipped.
2. **Transform** *t = T(x)*:
   - `log1p` for right-skewed counts and durations: blocks mined, kills, playtime. Minecraft counts are heavily skewed, so 10 → 100 should matter as much as 1,000 → 10,000.
   - `logit` for shares in 0–1 (night share, solo share). Moving from 2% to 10% is a bigger deal than 50% to 58%.
   - `identity` for already well-behaved values: clock times, entropy, composite scores, small-range counts.
3. **Leave-one-out robust z.** Compare the player with *everyone else*:

   z_i = (t_i − median_{j≠i} t_j) / s_i, where s_i = max(1.4826·MAD_{j≠i}, IQR_{j≠i}/1.349, floor)

   - **Median and MAD/IQR** are robust to skew and to other outliers. Mean and standard deviation would be dragged around by them.
   - **Leaving the player out** stops a huge outlier from inflating the spread and hiding itself.
   - **The floor** is the larger of the metric's `minSpread`, converted into transformed units, and a transform floor (0.2 on the log scale ≈ 22%; 0.3 on the logit scale ≈ 7 points around 50%). That's the **distinctiveness** guard: if everyone sits between 50% and 55%, nobody is remarkable.
4. **Only the #1 is a candidate.** For each direction a metric supports, only the single most extreme player can be a candidate. A tie at the top means nobody gets it. Every award is therefore an honest "most" or "least".
5. **Score:**

   | Factor | Formula | Meaning |
   |---|---|---|
   | extremeness | 1 − e^(−z/2) | 0 at the median, approaching 1 for big outliers |
   | rarity | 0.5 + 0.5·min(1, gap) | gap = distance to the runner-up in spread units; a clear #1 scores higher than a near-tie |
   | confidence | n / (n + n½) | n = the metric's own sample (hours, sessions, deaths, messages) |
   | population | min(1, (N − 1)/4) | dampens everything when few players are eligible |
   | reliability | per metric | 1.0 for directly observed data, 0.8–0.95 for looser derivations |

   **score = extremeness × rarity × confidence × population × reliability**

   A candidate also needs **z ≥ 1.5** and **score ≥ 0.15** (`config.ts`).

**Meta metrics** are computed after the others, from their z-scores:
- *The Statistical Freak:* the mean of a player's five largest directional z values.
- *Grindset / Vibes-Only:* the mean z across mining rate, ore rate, hostile kill rate, distance rate and advancement rate.

### Rates and small samples

Per-hour rates require a minimum playtime: 2–4 hours depending on the metric. The confidence factor shrinks the score further for small samples. With very little data, a player is NOT ELIGIBLE rather than being given a lucky extreme.

## 4. Allocation (global optimisation)

Picking each player's top three independently would hand the same award to several people. Instead, awards are assigned by **min-cost flow**:

```
source ─(3 edges: cost −3, −2, −1)─► player ─(cap 1)─► (player, family) ─(cap 1, cost −score)─► metric ─(cap 1)─► sink
```

| Edge | Constraint it enforces |
|---|---|
| metric → sink, capacity 1 | Each metric (and so each title) goes to **at most one player** |
| source → player, three unit edges | **At most three** awards per player. The decreasing bonuses (3, 2, 1) are all larger than any score (≤ 1), so the solver prefers **more awards in total** and always gives someone their **first** award before anyone gets a third |
| player → (player, family), capacity 1 | **At most one award per family** (e.g. not three death awards) |

The objective is to maximise Σ(slot bonus + score), with the constraints above.

**Solver:** successive shortest paths with Bellman-Ford (costs are negative), augmenting while the cheapest path still has negative cost.
- Min-cost flow cost is convex in the flow value, so stopping there gives the **global optimum**.
- Unlike a greedy pass, it will take an award away from a player who has better alternatives and give it to one who needs it. `awards.test.ts` contains a case where greedy fails and this succeeds.
- The graph is about 8 players × 100 metrics, so solving takes microseconds.

## 5. Explanations

Every title has two templates:
- `line()`: "8h 14m longest session".
- `explain()`: one or two sentences.

They're filled with the player's name, the formatted value, a comparison ("3.4× the server median", "while the rest of the server is at zero") and metric-specific extras (the Server Couple's partner, the Chaos Agent's actual shortest and longest sessions). No LLM is used, and the same data always produces the same text.

Templates are playful but never insulting, use the player's name instead of pronouns, and only state facts the data supports. Composite metrics are described as composites.

## 6. Configuration

`packages/core/src/awards/config.ts`:

```ts
export const AWARDS_CONFIG = {
  awardsPerPlayer: 3,
  minScore: 0.15,
  disabledCategories: [],   // "deaths" | "short_sessions" | "schedule" | "chat_volume" | "chat_style"
  disabledMetrics: [],      // metric ids from the catalog below
};
```

All sensitive categories are on by default. Change the file, push, and the next sync applies it.

## 7. Debug view

`/awards/?debug=1` shows every candidate with:
- the raw value, percentile and median;
- z, extremeness, rarity, confidence, population and reliability;
- the final score, and whether it won.

It also lists each metric that produced no candidate, with the reason (too few eligible players, tie, z too small, score too low) and every player's value or ineligibility reason. Add `&player=<name>` to filter to one player. The player page links there ("How were these picked?").

## 8. Example output

Hypothetical server: Ahmed 127 h, Ryan 61 h (mostly 1–4 AM), John 18 h with 63 deaths, Sam 54 h and 23 messages.

```
Ahmed   🏠 THE RESIDENT          127h played — 2.3× the server median
        🏃 THE MARATHON          8h 14m longest session
        💎 THE DIAMOND GOBLIN    2,431 diamond ore mined
Ryan    🌙 THE NIGHT SHIFT       71% late-night play
        🐺 THE LONE WOLF         64% of playtime alone
John    💀 RESPAWN ANY%          a death every 17m
        🌱 …no Touch Grass: playtime's one award went to Ahmed (higher score)
Sam     🤐 THE SILENT PROTAGONIST 23 messages in 54h
```

Real output from our server on 6 Oct 2026, after 4 days and 8 players:

```
Dr4Go5           📒 The Monster Collector · 🧭 The Wanderer · 🪨 The Ore Addict
scrowari_        🗑️ The Garbage Disposal · 🐟 The Fish · 💞 The Server Couple (with Dr4Go5)
OvlaxO           👻 Phantom Bait · 🥷 The Professional Squatter · 🕒 The 3AM Incident
WhitelightPlays  📸 The Tourism Department · 🌙 The Night Shift · 🚲 The Third Wheel
Tahiti64         🕊️ The Pacifist · 🌴 The Vibes-Only Player · 🌪️ The Chaos Agent
adufaru123       🌊 The Water Is Fine · 🐢 The Turtle
ganvir           🌱 The Touch Grass Award · 🧹 The Vacuum Cleaner
SusOnNewHands    📉 The Completionist's Nightmare
```

Players with fewer than three awards simply don't have three statistically remarkable numbers yet. That will change as data accumulates.

## 9. Rejected or merged statistics

| Requested | Decision | Why |
|---|---|---|
| Nether Commuter, per-dimension movement | Rejected | The statistics files don't split distance by dimension |
| Nether's Favorite, End Credits | Rejected (agreed) | Death messages have no dimension; player data only keeps the *last* death location |
| Midnight Miner | Rejected | Mining totals have no timestamps |
| Commands | Rejected | Vanilla doesn't log player commands |
| Comeback Kid | Rejected | No measurable definition we could defend |
| AFK Athlete | Merged into Basement Dweller | AFK can't be detected; described honestly as "least movement per hour" |
| Strip-Mine CEO, Slaughterhouse | Merged | Mining per session and kills per session duplicate the per-hour rates |
| Keyboard Enthusiast, Grindset | Merged into Grindset | Same composite activity rate |
| Doorbell | Merged into FOMO Merchant | Same measurement (joins right after someone else) |
| Hivemind | Merged into Server Couple | Same measurement (overlap with one player) |
| Time Traveler | Merged into Circadian Disaster | Same measurement (spread of play hours) |
| "One More Thing" | Merged into The 3AM Incident | Same measurement (late logouts) |
| Server Addict | Replaced by Main Character Syndrome | Playtime ÷ server lifespan is just total playtime rescaled; share of all server activity is more interesting |
| Sky Is Not Safe | Merged into Fall Guy | Same deaths |
| Loading Screen Enjoyer | Merged into Commitment Issues | Same measurement (very short sessions) |
| Speed Demon / Wanderlust | Merged | Same measurement (distance per hour) |
| Serial Killer / Monster Hunter | Merged | Same measurement (hostile kills per hour) |
| Zoologist's Nightmare / Butcher | Merged | Same measurement (animals killed) |
| Reply-time "most rapid responses" | Implemented as Reply Guy | Replies within 20 s of someone else's message |

## 10. Catalog

Generated from the code: run `npm run docs:awards` after changing `catalog.ts`.

<!-- catalog:start -->
100 metrics, 117 award titles.

#### Playtime

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `playtime_total` | 🏠 The Resident | 🌱 The Touch Grass Award | LOG | Sum of all session durations (join → leave) from the server log. | 1 | log1p |
| `playtime_per_day` | 📈 The No-Life Speedrun | ☕ The Casual | DERIVED | Total playtime ÷ number of distinct days with any play (community timezone). | 2 | log1p |
| `server_time_share` | 🎬 Main Character Syndrome | — | DERIVED | Their playtime ÷ total time anyone at all was online. | 3 | logit |
| `active_days` | 🔁 The Returner | — | DERIVED | Number of distinct calendar days with any playtime. | 2 | log1p |
| `longest_streak` | 🔥 The Regular | — | DERIVED | Longest run of consecutive days with playtime. | 3 | log1p |

#### Sessions

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `longest_session` | 🏃 The Marathon | — | LOG | Longest single session (join → leave). | 2 | log1p |
| `session_count` | 🚪 Can't Log Off | — | LOG | Number of sessions. | 1 | log1p |
| `avg_session` | 💼 The Weekend Employee | 🧳 The Tourist | LOG | Mean session duration. | 4 | log1p |
| `session_cv` | 🌪️ The Chaos Agent | 📏 The Consistency Merchant | DERIVED | Coefficient of variation of session lengths (standard deviation ÷ mean). | 6 | identity |
| `longest_gap` | 🏔️ The Hermit | — | DERIVED | Longest break between two consecutive sessions. | 3 | log1p |
| `short_share_10` *(short_sessions)* | 👀 "I'll Just Check Something" | — | DERIVED | Share of sessions shorter than 10 minutes. | 6 | logit |
| `short_count_5` *(short_sessions)* | 💔 The Commitment Issues Award | — | DERIVED | Number of sessions shorter than 5 minutes. | 5 | log1p |

#### Schedule

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `night_share` *(schedule)* | 🌙 The Night Shift | — | DERIVED | Share of playtime between 00:00 and 06:00 (community timezone). | 3 | logit |
| `morning_share` | 🌅 The Morning Person | — | DERIVED | Share of playtime between 06:00 and 12:00. | 3 | logit |
| `nine_to_five_share` | 🗂️ The 9-to-5er | — | DERIVED | Share of playtime on weekdays between 09:00 and 17:00. | 3 | logit |
| `after_school_share` | 🎒 The After-School Special | — | DERIVED | Share of playtime between 15:00 and 19:00. | 3 | logit |
| `evening_share` | 🌆 The Evening Shift | — | DERIVED | Share of playtime between 19:00 and midnight. | 3 | logit |
| `lunch_share` | 🥪 The Lunch Break | — | DERIVED | Share of playtime between 11:30 and 13:30. | 3 | logit |
| `weekend_share` | 🎉 The Weekend Warrior | 🗓️ The Weekday Warrior | DERIVED | Share of playtime on Saturday and Sunday. | 4 | logit |
| `sunday_night_share` | 😰 The Sunday Scaries | — | DERIVED | Share of playtime on Sunday between 18:00 and midnight. | 3 | logit |
| `typical_logout` *(schedule)* | 🕒 The 3AM Incident | 🛏️ The Early Retirement | DERIVED | Median logout time of day (measured from noon so late nights sort after evenings). | 4 | identity |
| `sunrise_sessions` *(schedule)* | 🌄 The Sunrise Enjoyer | — | DERIVED | Sessions that were still going at 06:00. | 3 | log1p |
| `longest_overnight` *(schedule)* | ☕ Sleep Is Optional | — | DERIVED | Longest session that crossed midnight. | 2 | log1p |
| `schedule_entropy` | 🌀 The Circadian Disaster | — | DERIVED | Normalised Shannon entropy of session start hours (0 = always the same hour, 1 = completely random). | 8 | identity |

#### Deaths

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `deaths` *(deaths)* | 🪦 The Graveyard Regular | — | LOG | Number of death messages in the log. | 2 | log1p |
| `deaths_per_hour` *(deaths)* | 💀 Respawn Any% | 🛡️ The Immortal | DERIVED | Deaths ÷ hours played. | 4 | log1p |
| `env_death_share` *(deaths)* | 🧬 The Darwin Award | — | LOG | Share of deaths caused by the environment (falls, lava, fire, drowning, suffocation, void…) rather than mobs. | 3 | logit |
| `mob_deaths` *(deaths)* | ⚔️ The Violent End | — | LOG | Deaths to mobs (melee or projectile). | 2 | log1p |
| `fall_deaths` *(deaths)* | 🪂 The Fall Guy | — | LOG | Deaths from falling (including being knocked off ledges). | 2 | log1p |
| `creeper_deaths` *(deaths)* | 💥 Certified Creeper Victim | — | LOG | Deaths where the killer was a Creeper. | 2 | log1p |
| `lava_fire_deaths` *(deaths)* | 🌋 The Lava Enthusiast | — | LOG | Deaths from lava or fire. | 2 | log1p |
| `drowning_deaths` *(deaths)* | 🌊 The Water Is Fine | — | LOG | Deaths by drowning. | 2 | log1p |
| `longest_deathless` | 🧘 Unreasonably Alive | — | DERIVED | Most playtime between two deaths (or since joining / since the last death). | 3 | log1p |
| `max_deaths_session` *(deaths)* | 🐈 The Nine Lives Problem | — | DERIVED | Most deaths within a single session. | 2 | log1p |
| `shortest_death_gap` *(deaths)* | — | 🔂 The Immediate Regret | DERIVED | Shortest time between two consecutive deaths. | 2 | log1p |
| `damage_taken_rate` | 🥊 The Punching Bag | — | PLAYER_STATS | Damage taken (hearts, from the statistics file) ÷ hours played. | 2 | log1p |

#### Mining

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `blocks_mined` | ⛏️ The OSHA Violation | — | PLAYER_STATS | Total blocks mined (sum of the `mined` statistics). | 1 | log1p |
| `mining_rate` | 🏗️ The Quarry | — | PLAYER_STATS | Blocks mined ÷ hours played (statistics file playtime). | 2 | log1p |
| `deepslate_share` | 🕳️ The Deep Dweller | — | PLAYER_STATS | Share of mined blocks that are deepslate-layer blocks (deepslate variants and tuff). | 300 | logit |
| `logs_mined` | 🪓 The Lumberjack | — | PLAYER_STATS | Logs, stems, wood and hyphae harvested. | 1 | log1p |
| `diamond_ore` | 💎 The Diamond Goblin | — | PLAYER_STATS | Diamond ore + deepslate diamond ore mined. | 1 | log1p |
| `ore_rate` | 🪨 The Ore Addict | — | PLAYER_STATS | Ores (any *_ore block, plus ancient debris) mined ÷ hours played. | 2 | log1p |
| `ore_share` | ✨ The Dirt Hater | — | PLAYER_STATS | Ores ÷ all blocks mined. | 300 | logit |
| `tools_broken` | 🔨 The Pickaxe Abuser | — | PLAYER_STATS | Tools and items worn out until they broke (sum of the `broken` statistics). | 1 | log1p |

#### Items

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `picked_up` | 📦 The Hoarder | — | PLAYER_STATS | Items picked up (sum of the `picked_up` statistics). | 1 | log1p |
| `dropped` | 🗑️ The Garbage Disposal | — | PLAYER_STATS | Items dropped (sum of the `dropped` statistics). | 1 | log1p |
| `pickup_drop_ratio` | 🧹 The Vacuum Cleaner | — | PLAYER_STATS | Items picked up ÷ (items dropped + 1). | 300 | log1p |
| `crafted` | 🏭 The Assembly Line | — | PLAYER_STATS | Items crafted (sum of the `crafted` statistics). | 1 | log1p |
| `containers` | 🗃️ The Chest Goblin | — | PLAYER_STATS | Chests, barrels, shulker boxes and ender chests opened. | 1 | log1p |

#### Movement

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `distance` | 🧭 The Wanderer | — | PLAYER_STATS | Distance travelled by any means (walk, sprint, swim, boat, horse, elytra… — every *_one_cm statistic except falling). | 1 | log1p |
| `distance_rate` | 💨 The Speed Demon | 🛋️ The Basement Dweller | PLAYER_STATS | Kilometres travelled ÷ hours played. | 2 | log1p |
| `jump_rate` | 🦘 The Parkour Incident | — | PLAYER_STATS | Jumps ÷ hours played. | 2 | log1p |
| `sneak_share` | 🥷 The Professional Squatter | — | PLAYER_STATS | Time spent sneaking ÷ playtime. | 2 | logit |
| `sprint_share` | 🏅 The Track Star | — | PLAYER_STATS | Distance sprinted ÷ total distance. | 2 | logit |
| `swim_distance` | 🐟 The Fish | — | PLAYER_STATS | Distance swum (on and under water). | 1 | log1p |
| `boat_distance` | ⛵ The Admiral | — | PLAYER_STATS | Distance travelled by boat. | 1 | log1p |
| `fall_distance` | 🍎 The Gravity Tester | — | PLAYER_STATS | Total distance fallen. | 1 | log1p |
| `biomes` | 🗺️ The Human GPS | — | ADVANCEMENTS | Biomes visited (criteria of the Adventuring Time advancement). | 1 | identity |
| `distance_per_advancement` | 🌫️ The Lost Soul | — | DERIVED | Kilometres travelled ÷ advancements earned. | 2 | log1p |
| `tourism_ratio` | 📸 The Tourism Department | — | DERIVED | Kilometres travelled per 1,000 blocks mined. | 2 | log1p |

#### Combat

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `mob_kills` | ☠️ The Genocide | — | PLAYER_STATS | Mobs killed (the `mob_kills` statistic). | 1 | log1p |
| `hostile_kill_rate` | 🏹 The Monster Hunter | 🕊️ The Pacifist | PLAYER_STATS | Hostile mobs killed ÷ hours played. | 2 | log1p |
| `passive_kills` | 🥩 The Butcher | — | PLAYER_STATS | Passive/neutral animals killed (cows, pigs, sheep, chickens, fish…). | 1 | log1p |
| `spiders_killed` | 🕷️ The Spider Problem | — | PLAYER_STATS | Spiders and cave spiders killed. | 1 | log1p |
| `zombies_killed` | 🧟 The Zombie Apocalypse | — | PLAYER_STATS | Zombies, husks, drowned and zombie villagers killed. | 1 | log1p |
| `creepers_killed` | 🪧 The Creeper Union Buster | — | PLAYER_STATS | Creepers killed. | 1 | log1p |
| `mob_types` | 📒 The Monster Collector | — | PLAYER_STATS | Distinct mob types killed at least once. | 1 | identity |
| `shield_blocked` | 🐢 The Turtle | — | PLAYER_STATS | Damage blocked with a shield (hearts). | 1 | log1p |
| `player_kills` | 🩸 The Bloodhound | — | PLAYER_STATS | Players killed (the `player_kills` statistic; inactive until someone has a kill). | 1 | log1p |

#### Progression

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `advancements` | 🏆 The Completionist | 📉 The Completionist's Nightmare | ADVANCEMENTS | Advancements completed (from the advancements file; recipe unlocks and tab roots excluded). | 1 | identity |
| `advancement_rate` | 🚀 The Overachiever | 🎣 The Productivity Scam | DERIVED | Advancements completed ÷ hours played. | 3 | log1p |
| `milestone_hours` | 🐌 The Procrastinator | ⏱️ The Speedrunner Wannabe | DERIVED | Average playtime (from the log) before reaching key milestones: Acquire Hardware, Diamonds!, the Nether, a Fortress, Eye Spy, the End. | 2 | log1p |
| `first_to` | 🥇 The First Blood | — | ADVANCEMENTS | Advancements this player completed before anyone else on the server. | 1 | log1p |
| `side_quests` | 🧩 The Side-Quest Merchant | — | ADVANCEMENTS | Criteria completed in long checklist advancements (Adventuring Time, Monsters Hunted, A Balanced Diet, Two by Two…). | 1 | log1p |
| `late_bloomer` | 🌸 The Late Bloomer | — | DERIVED | Share of their advancements earned in the second half of their own playtime. | 6 | logit |
| `historian` | 📜 The Historian | — | DERIVED | Time between their first and latest advancement ÷ the server's lifespan. | 6 | logit |
| `xp_level` | 🟢 The XP Hoarder | — | PLAYER_DATA | Current XP level (player data). | 1 | log1p |
| `dragon` | 🐉 The Dragon Slayer | — | PLAYER_DATA | Has seen the End credits (beaten the Ender Dragon). Only awarded when exactly one player has. | 1 | identity |
| `trades` | 🤑 The Villager Exploiter | — | PLAYER_STATS | Villager trades. | 1 | log1p |
| `animals_bred` | 💘 The Matchmaker | — | PLAYER_STATS | Animals bred. | 1 | log1p |
| `enchants` | 🔮 The Wizard | — | PLAYER_STATS | Items enchanted. | 1 | log1p |
| `sleep_rate` | 😴 Well Rested | 👻 Phantom Bait | PLAYER_STATS | Times slept in a bed ÷ hours played. | 3 | log1p |

#### Chat

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `chat_messages` *(chat_volume)* | 🗣️ The Yap Machine | — | LOG | Chat messages sent (counted; content is never stored). | 2 | log1p |
| `chat_rate` *(chat_volume)* | 📢 The Server Announcer | 🤐 The Silent Protagonist | DERIVED | Chat messages ÷ hours played. | 4 | log1p |
| `late_night_messages` *(chat_volume)* | 🦉 The 3AM Yapper | — | LOG | Chat messages sent between 00:00 and 06:00. | 2 | log1p |
| `replies` *(chat_volume)* | ↩️ The Reply Guy | — | DERIVED | Messages sent within 20 seconds of someone else's message. | 10 | log1p |
| `message_length` *(chat_style)* | 📝 The Essayist | 💬 The One-Liner | LOG | Average message length in characters (from per-message length; text not stored). | 15 | log1p |
| `caps_share` *(chat_style)* | 🔠 The Caps Lock Incident | — | LOG | Average share of capital letters per message (messages with at least 4 letters). | 10 | logit |
| `repeat_share` *(chat_style)* | 🤖 The NPC | — | LOG | Share of messages identical (ignoring case/spacing) to something they'd already said — compared by hash. | 15 | logit |

#### Social

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `solo_share` | 🐺 The Lone Wolf | 🦋 The Social Butterfly | DERIVED | Share of playtime with nobody else online. | 3 | logit |
| `party_share` | 🪩 The Party Animal | — | DERIVED | Share of playtime with three or more other players online. | 3 | logit |
| `third_wheel` | 🚲 The Third Wheel | — | DERIVED | Share of playtime with exactly two other players online. | 3 | logit |
| `pack_animal` | 🐑 The Pack Animal | — | DERIVED | Average number of other players online during their sessions (time-weighted). | 3 | identity |
| `server_couple` | 💞 The Server Couple | — | DERIVED | The largest share of their playtime spent online with one specific other player. | 3 | logit |
| `fomo` | 📲 The FOMO Merchant | — | DERIVED | Share of their sessions that began within 10 minutes of another player joining. | 5 | logit |
| `last_man_standing` | 🕯️ The Last Man Standing | — | DERIVED | Sessions where they had company, and were the last one left when they logged off. | 3 | log1p |
| `welcome_committee` | 👋 The Welcome Committee | — | DERIVED | Times another player joined while they were already online. | 3 | log1p |
| `host` | 🔑 The Host | — | DERIVED | Share of their sessions where they were the first one online. | 5 | logit |

#### Meta

| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |
|---|---|---|---|---|---|---|
| `statistical_freak` | 🧪 The Statistical Freak | — | DERIVED | Mean of the player's five most extreme robust z-scores across every eligible metric. | 3 | identity |
| `grindset` | 💪 The Grindset | 🌴 The Vibes-Only Player | DERIVED | Average z-score of mining rate, ore rate, hostile kill rate, distance rate and advancement rate (activity per hour). | 3 | identity |

<!-- catalog:end -->
