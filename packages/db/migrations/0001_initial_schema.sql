-- SMP Analytics — initial schema.
--
-- Everything lives in the `smp` schema (not `public`) so Supabase's
-- auto-generated REST API doesn't expose it. Access is only via direct
-- Postgres connections: the ingester (owner) and the API (read-only role).
--
-- Source of truth: `events` (one row per meaningful log line).
-- Derived and fully rebuilt on each sync: `sessions`, `server_runs`,
-- `player_stats`, `server_stats`.

create schema if not exists smp;

-- ─── Players ──────────────────────────────────────────────────────────────

create table smp.players (
  id           bigint generated always as identity primary key,
  -- Mojang UUID as text, or `name:<lowercase name>` if no UUID was ever seen.
  player_key   text not null unique,
  uuid         uuid unique,
  name         text not null,
  -- Persisted palette slot so a player's colour never changes between deploys.
  color_index  integer not null unique check (color_index >= 0),
  first_seen   timestamptz not null,
  last_seen    timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table smp.player_names (
  player_id   bigint not null references smp.players (id) on delete cascade,
  name        text not null,
  first_seen  timestamptz not null,
  last_seen   timestamptz not null,
  primary key (player_id, name)
);
create index player_names_name_idx on smp.player_names (lower(name));

-- ─── Ingestion state ──────────────────────────────────────────────────────

-- One row per log *run* (the content of one log file). latest.log and the
-- .log.gz it later becomes share the same fingerprint, so a file is never
-- imported twice under two names.
create table smp.log_files (
  id               bigint generated always as identity primary key,
  -- `<log date>|<sha256 of first line>` — stable across the rename/gzip.
  fingerprint      text not null unique,
  -- sha256 of the first line alone: lets a rotated .gz be matched to the
  -- latest.log it used to be even if latest.log's date was inferred wrong.
  first_line_hash  text not null,
  source_name      text not null,
  log_date         date not null,
  -- Sequence number from the rotated filename; null while still latest.log.
  seq              integer,
  lines_processed  integer not null default 0 check (lines_processed >= 0),
  size_bytes       bigint,
  -- true once seen as an immutable rotated .gz and fully processed.
  is_complete      boolean not null default false,
  first_ts         timestamptz,
  last_ts          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index log_files_source_idx on smp.log_files (source_name);

create table smp.parse_issues (
  id           bigint generated always as identity primary key,
  log_file_id  bigint not null references smp.log_files (id) on delete cascade,
  line_no      integer not null,
  reason       text not null,
  -- Raw line with IP addresses redacted.
  raw          text not null,
  created_at   timestamptz not null default now(),
  unique (log_file_id, line_no, reason)
);

create table smp.sync_runs (
  id           bigint generated always as identity primary key,
  mode         text not null check (mode in ('import', 'sync')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'success', 'failed')),
  summary      jsonb not null default '{}'::jsonb,
  error        text
);
create index sync_runs_started_idx on smp.sync_runs (started_at desc);

-- ─── Events (source of truth) ─────────────────────────────────────────────

create type smp.event_type as enum (
  'SERVER_START', 'SERVER_READY', 'SERVER_STOP', 'SERVER_PAUSE',
  'PLAYER_UUID', 'PLAYER_LOGIN', 'JOIN', 'LEAVE', 'DISCONNECT',
  'DEATH', 'ADVANCEMENT', 'CHAT'
);

create table smp.events (
  id           bigint generated always as identity primary key,
  log_file_id  bigint not null references smp.log_files (id) on delete cascade,
  -- (log_file_id, line_no) is the idempotency key: re-processing a file
  -- can never insert the same line twice.
  line_no      integer not null check (line_no > 0),
  ts           timestamptz not null,
  type         smp.event_type not null,
  player_id    bigint references smp.players (id) on delete set null,
  -- Type-specific payload (death cause, advancement name, coordinates, …).
  data         jsonb not null default '{}'::jsonb,
  unique (log_file_id, line_no)
);
create index events_ts_idx on smp.events (ts);
create index events_player_type_ts_idx on smp.events (player_id, type, ts);
create index events_type_ts_idx on smp.events (type, ts);

-- ─── Derived: server runs & sessions ──────────────────────────────────────

create table smp.server_runs (
  id              bigint generated always as identity primary key,
  start_ts        timestamptz not null,
  end_ts          timestamptz not null,
  end_reason      text not null check (end_reason in ('stop', 'crash', 'open')),
  version         text,
  start_event_id  bigint unique references smp.events (id) on delete cascade,
  check (end_ts >= start_ts)
);
create index server_runs_start_idx on smp.server_runs (start_ts);

create table smp.sessions (
  id                 bigint generated always as identity primary key,
  player_id          bigint not null references smp.players (id) on delete cascade,
  server_run_id      bigint references smp.server_runs (id) on delete set null,
  start_ts           timestamptz not null,
  end_ts             timestamptz not null,
  end_reason         text not null check (end_reason in ('leave', 'server_stop', 'crash', 'inferred_empty', 'rejoin', 'open')),
  join_event_id      bigint not null unique references smp.events (id) on delete cascade,
  leave_event_id     bigint references smp.events (id) on delete set null,
  disconnect_reason  text,
  duration_seconds   integer generated always as (floor(extract(epoch from (end_ts - start_ts)))::integer) stored,
  check (end_ts >= start_ts)
);
-- Timeline range queries: start_ts < :to AND end_ts > :from
create index sessions_start_idx on smp.sessions (start_ts);
create index sessions_end_idx on smp.sessions (end_ts);
create index sessions_player_start_idx on smp.sessions (player_id, start_ts desc);

-- ─── Derived: precomputed statistics ──────────────────────────────────────
-- Computed by the sync job (TypeScript, no CPU limits) so the API Worker on
-- Cloudflare's free tier (10 ms CPU/request) only has to return JSON.

create table smp.player_stats (
  player_id    bigint primary key references smp.players (id) on delete cascade,
  stats        jsonb not null,
  -- The 3 stats highlighted in the timeline popover (see core/stats/registry.ts).
  highlights   jsonb not null default '[]'::jsonb,
  computed_at  timestamptz not null default now()
);

create table smp.server_stats (
  id           smallint primary key default 1 check (id = 1),
  stats        jsonb not null,
  computed_at  timestamptz not null default now()
);

-- ─── Convenience views ────────────────────────────────────────────────────

create view smp.deaths as
select
  e.id,
  e.player_id,
  e.ts,
  e.data ->> 'cause'    as cause,
  e.data ->> 'category' as category,
  e.data ->> 'killer'   as killer,
  e.data ->> 'weapon'   as weapon,
  e.data ->> 'message'  as message
from smp.events e
where e.type = 'DEATH';

-- First time each player earned each advancement.
create view smp.player_advancements as
select distinct on (e.player_id, e.data ->> 'advancement')
  e.player_id,
  e.data ->> 'advancement' as advancement,
  e.data ->> 'kind'        as kind,
  e.ts                     as earned_at
from smp.events e
where e.type = 'ADVANCEMENT' and e.player_id is not null
order by e.player_id, e.data ->> 'advancement', e.ts;

-- ─── Read-only role for the API ───────────────────────────────────────────
-- Created without login. To let the Cloudflare Worker use it, run once in
-- the Supabase SQL editor (see docs/deployment.md):
--   alter role smp_reader with login password '<strong password>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'smp_reader') then
    create role smp_reader nologin;
  end if;
end
$$;

grant usage on schema smp to smp_reader;
grant select on all tables in schema smp to smp_reader;
alter default privileges in schema smp grant select on tables to smp_reader;
-- Ingestion internals aren't needed by the API.
revoke select on smp.parse_issues from smp_reader;
