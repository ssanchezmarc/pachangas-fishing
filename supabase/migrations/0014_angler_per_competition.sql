-- Issue 30 — Anglers live inside a competition, not in a club-wide roster.
-- The angler is added while managing a competition; `angler` moves from the club
-- to the competition. Pairs (#06) and lots (#20) keep referencing anglers, now of
-- that competition. The same person across two competitions = two angler rows.

-- 1) Attach angler to a competition.
alter table angler add column competition_id uuid references competition (id) on delete cascade;

-- Backfill (no-op on a fresh reset): place each existing angler in the first
-- competition of its old club; drop any angler whose club has no competition.
update angler a
  set competition_id = (
    select c.id from competition c
    where c.club_id = a.club_id
    order by c.created_at
    limit 1
  )
  where a.competition_id is null;
delete from angler where competition_id is null;

alter table angler alter column competition_id set not null;
create index on angler (competition_id);

-- 2) License is now unique within a competition (was within a club).
drop index if exists angler_license_per_club;
create unique index angler_license_per_competition on angler (competition_id, license_number);

-- 3) Drop the old club anchor.
alter table angler drop column club_id;

-- 4) RLS: writes keyed to the competition's club membership; public read stays.
drop policy if exists "committee write angler" on angler;
create policy "member writes angler" on angler for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));
