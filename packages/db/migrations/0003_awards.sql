-- Awards replace the placeholder "highlights".
alter table smp.player_stats rename column highlights to awards;

-- Server-wide awards picture, rebuilt every sync: metric catalog, who won
-- what, per-metric records, and every candidate with the numbers behind its
-- score (for the debug view).
create table smp.awards_snapshot (
  id           smallint primary key default 1 check (id = 1),
  data         jsonb not null,
  computed_at  timestamptz not null default now()
);

grant select on smp.awards_snapshot to smp_reader;
