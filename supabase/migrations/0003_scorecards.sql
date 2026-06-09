-- Slice 03 — Scorecard, catch and evidence photo.
-- 1 scorecard per angler and round. Each catch stores its size; undersized is
-- derived by the rules engine but persisted for traceability. The footer totals
-- (checksum) are stored on the scorecard. The original photo is private evidence.

-- Processing/validation status of the scorecard (slices 08-09).
create type scorecard_status as enum ('draft', 'auto', 'flagged', 'confirmed');

create table scorecard (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  round_id uuid not null references round (id) on delete cascade,
  entry_id uuid not null references round_entry (id) on delete cascade,
  status scorecard_status not null default 'draft',
  -- Declared footer totals (checksum against the catch detail).
  total_legal_catches int,
  total_undersized int,
  biggest_catch_cm numeric(5, 2),
  -- Rules-engine result (cache; source of truth = catches).
  catch_points numeric(10, 2) not null default 0,
  -- Validation issues (slice 08) if flagged, as {code, params} objects so they
  -- can be rendered in any locale (i18n, issue 14).
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, entry_id)
);
create index on scorecard (club_id);
create index on scorecard (round_id);

create table catch (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  scorecard_id uuid not null references scorecard (id) on delete cascade,
  size_cm numeric(5, 2) not null,
  undersized boolean not null,
  seq int not null default 0
);
create index on catch (club_id);
create index on catch (scorecard_id);

-- Evidence: original scorecard photo in private storage.
create table scorecard_photo (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  scorecard_id uuid not null references scorecard (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index on scorecard_photo (club_id);
create index on scorecard_photo (scorecard_id);

alter table scorecard enable row level security;
alter table catch enable row level security;
alter table scorecard_photo enable row level security;

-- The scorecard and its catches are public (live standings); the photo is NOT.
create policy "public read scorecard" on scorecard for select using (true);
create policy "public read catch" on catch for select using (true);

create policy "committee write scorecard" on scorecard for all
  to authenticated using (true) with check (true);
create policy "committee write catch" on catch for all
  to authenticated using (true) with check (true);
-- scorecard_photo: only the authenticated committee can read/write (private evidence, RNF-5).
create policy "committee photo" on scorecard_photo for all
  to authenticated using (true) with check (true);
