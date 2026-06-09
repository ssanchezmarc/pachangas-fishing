-- Slice 01 — Core model: club, competition, round.
-- Every table carries club_id from day 1 (PRD §3): enables future multi-club
-- without a rewrite, but no SaaS machinery yet. Domain language: `club`, NOT
-- `tenant`.

create extension if not exists pgcrypto;

-- A single club in v1 (multi-club in Phase 4).
create table club (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Competition / League (e.g. "VII Liga Duos Alto Carrión 2026").
-- Scoring and aggregation config is declarative per competition (PRD §6): stored
-- as JSON and consumed by the rules engine (src/domain).
create table competition (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  name text not null,
  -- ScoringConfig (see src/domain/types.ts). Alto Carrión preset by default.
  scoring_config jsonb not null default
    '{"minSizeCm":19,"validCatchBasePoints":100,"sizeFactor":0.01,"undersizedCatchPoints":60,"rounding":"up"}'::jsonb,
  -- AggregationConfig (FEPyC tiebreaks by default).
  aggregation_config jsonb not null default
    '{"tiebreaks":["catchPoints","biggestCatch"]}'::jsonb,
  created_at timestamptz not null default now()
);
create index on competition (club_id);

-- Lifecycle states of a round's standings (slice 12).
create type round_status as enum ('open', 'provisional', 'appeals', 'final');

create table round (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  competition_id uuid not null references competition (id) on delete cascade,
  name text not null,
  date date not null,
  start_time time,
  end_time time,
  status round_status not null default 'open',
  created_at timestamptz not null default now()
);
create index on round (club_id);
create index on round (competition_id);

-- RLS: public read (open web), writes only when authenticated (committee).
alter table club enable row level security;
alter table competition enable row level security;
alter table round enable row level security;

create policy "public read club" on club for select using (true);
create policy "public read competition" on competition for select using (true);
create policy "public read round" on round for select using (true);

create policy "committee write club" on club for all
  to authenticated using (true) with check (true);
create policy "committee write competition" on competition for all
  to authenticated using (true) with check (true);
create policy "committee write round" on round for all
  to authenticated using (true) with check (true);
