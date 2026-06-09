-- Slice 02 — Round roster: angler, pair, sector, entry.
-- The controller is another angler (fishes one stretch, controls another): modelled
-- as an FK to another angler within the same round entry (PRD §5).

create table angler (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index on angler (club_id);

-- Pair (Duo) = 2 anglers, scoped to a competition.
create table pair (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  competition_id uuid not null references competition (id) on delete cascade,
  name text,
  angler1_id uuid not null references angler (id),
  angler2_id uuid not null references angler (id),
  check (angler1_id <> angler2_id)
);
create index on pair (club_id);
create index on pair (competition_id);

-- Sector / stretch within a round.
create table sector (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  round_id uuid not null references round (id) on delete cascade,
  name text not null,
  unique (round_id, name)
);
create index on sector (club_id);
create index on sector (round_id);

-- Roster: bib → angler → sector → who they control, per round.
create table round_entry (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  round_id uuid not null references round (id) on delete cascade,
  bib text not null,
  angler_id uuid not null references angler (id),
  sector_id uuid not null references sector (id),
  -- Who this angler controls (another angler in the same round). Nullable until
  -- control is assigned.
  controls_angler_id uuid references angler (id),
  unique (round_id, bib),
  unique (round_id, angler_id)
);
create index on round_entry (club_id);
create index on round_entry (round_id);

alter table angler enable row level security;
alter table pair enable row level security;
alter table sector enable row level security;
alter table round_entry enable row level security;

create policy "public read angler" on angler for select using (true);
create policy "public read pair" on pair for select using (true);
create policy "public read sector" on sector for select using (true);
create policy "public read entry" on round_entry for select using (true);

create policy "committee write angler" on angler for all
  to authenticated using (true) with check (true);
create policy "committee write pair" on pair for all
  to authenticated using (true) with check (true);
create policy "committee write sector" on sector for all
  to authenticated using (true) with check (true);
create policy "committee write entry" on round_entry for all
  to authenticated using (true) with check (true);
