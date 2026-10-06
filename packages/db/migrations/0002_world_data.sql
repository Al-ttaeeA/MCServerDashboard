-- Per-player vanilla world data (statistics, advancements, a few player-data
-- fields), read from <world>/players/{stats,advancements,data} over SFTP.
--
-- Keyed by Mojang UUID rather than smp.players.id: world files can exist for
-- someone the logs haven't attributed yet, and the join happens at rebuild.

-- Change tracking so unchanged files aren't downloaded again.
create table smp.world_files (
  path        text primary key,
  size_bytes  bigint not null,
  mtime       timestamptz not null,
  updated_at  timestamptz not null default now()
);

-- Latest statistics file per player (namespace-stripped, see core/world).
create table smp.player_world_stats (
  uuid          uuid primary key,
  data_version  integer,
  stats         jsonb not null,
  updated_at    timestamptz not null default now()
);

-- One snapshot per player per UTC day, for trends later. ~40 MB/year at our size.
create table smp.player_world_stats_daily (
  uuid   uuid not null,
  day    date not null,
  stats  jsonb not null,
  primary key (uuid, day)
);

-- Non-recipe advancements with per-criterion completion timestamps.
create table smp.player_world_advancements (
  uuid          uuid primary key,
  data_version  integer,
  advancements  jsonb not null,
  updated_at    timestamptz not null default now()
);

-- Only the safe fields from player NBT. Position/inventory are never stored.
create table smp.player_profile_data (
  uuid          uuid primary key,
  xp_level      integer,
  xp_total      integer,
  seen_credits  boolean not null default false,
  updated_at    timestamptz not null default now()
);

grant select on smp.player_world_stats, smp.player_world_advancements, smp.player_profile_data to smp_reader;
revoke select on smp.world_files, smp.player_world_stats_daily from smp_reader;
