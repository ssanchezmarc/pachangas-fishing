-- Issue 29 — Multi-club: real multi-tenancy keyed to the authenticated organizer.
--
-- Domain model (closed in a grill-me session, 2026-06-09):
--   - Only `competition` belongs to a `club` (competition.club_id is the single
--     anchor). Everything operational (round, sector, lot, pair, round_entry,
--     scorecard, catch, scorecard_photo, claim, audit_log) belongs to a
--     *competition*, so it carries a denormalized `competition_id` instead of the
--     old `club_id`. The denormalized column is filled from the parent by a
--     BEFORE INSERT trigger, so app code never sets a tenant id by hand and a row
--     can never point at a competition of another club.
--   - Membership organizer↔club lives in `club_member` (supports co-organizers
--     later). RLS writes check membership; public reads stay wide open.
--
-- This migration does NOT touch `angler` (handled in 0014, issue 30) nor the
-- private Storage bucket (documented gap: photos remain readable by any
-- authenticated organizer for now).

-- 1) Membership organizer↔club -----------------------------------------------
create table club_member (
  club_id uuid not null references club (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index on club_member (user_id);

alter table club_member enable row level security;
-- An organizer reads/manages only their own membership rows.
create policy "member reads own memberships" on club_member for select
  to authenticated using (user_id = auth.uid());
create policy "member self-enrolls" on club_member for insert
  to authenticated with check (user_id = auth.uid());

-- 2) RLS helper functions (security definer to avoid recursive policy checks) --
create or replace function is_club_member(target_club uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from club_member m
    where m.club_id = target_club and m.user_id = auth.uid()
  );
$$;

create or replace function is_competition_mine(target_competition uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1
    from competition c
    join club_member m on m.club_id = c.club_id
    where c.id = target_competition and m.user_id = auth.uid()
  );
$$;

-- 3) club / competition write policies keyed to membership --------------------
drop policy if exists "committee write club" on club;
create policy "member creates club" on club for insert
  to authenticated with check (true);
create policy "member updates own club" on club for update
  to authenticated using (is_club_member(id)) with check (is_club_member(id));
create policy "member deletes own club" on club for delete
  to authenticated using (is_club_member(id));

drop policy if exists "committee write competition" on competition;
create policy "member writes competition" on competition for all
  to authenticated using (is_club_member(club_id)) with check (is_club_member(club_id));

-- 4) Denormalize competition_id onto the operational tables -------------------
-- round, lot and pair already carry competition_id as a domain column; the rest
-- get it filled from their immediate parent by a trigger.
alter table sector add column competition_id uuid references competition (id) on delete cascade;
alter table round_entry add column competition_id uuid references competition (id) on delete cascade;
alter table scorecard add column competition_id uuid references competition (id) on delete cascade;
alter table catch add column competition_id uuid references competition (id) on delete cascade;
alter table scorecard_photo add column competition_id uuid references competition (id) on delete cascade;
alter table claim add column competition_id uuid references competition (id) on delete cascade;
-- audit_log: nullable + on delete set null, so deleting a competition keeps its
-- immutable trail (the link is cleared, the row survives, RNF-4). Set by the app.
alter table audit_log add column competition_id uuid references competition (id) on delete set null;

create index on sector (competition_id);
create index on round_entry (competition_id);
create index on scorecard (competition_id);
create index on catch (competition_id);
create index on scorecard_photo (competition_id);
create index on claim (competition_id);
create index on audit_log (competition_id);

-- Triggers: derive competition_id from the parent on insert.
create or replace function set_competition_from_round()
returns trigger language plpgsql as $$
begin
  if new.competition_id is null then
    select competition_id into new.competition_id from round where id = new.round_id;
  end if;
  return new;
end;
$$;

create or replace function set_competition_from_scorecard()
returns trigger language plpgsql as $$
begin
  if new.competition_id is null then
    select competition_id into new.competition_id from scorecard where id = new.scorecard_id;
  end if;
  return new;
end;
$$;

create trigger trg_sector_competition before insert on sector
  for each row execute function set_competition_from_round();
create trigger trg_entry_competition before insert on round_entry
  for each row execute function set_competition_from_round();
create trigger trg_scorecard_competition before insert on scorecard
  for each row execute function set_competition_from_round();
create trigger trg_claim_competition before insert on claim
  for each row execute function set_competition_from_round();
create trigger trg_catch_competition before insert on catch
  for each row execute function set_competition_from_scorecard();
create trigger trg_photo_competition before insert on scorecard_photo
  for each row execute function set_competition_from_scorecard();

-- 5) Backfill competition_id for any pre-existing rows (no-op on fresh reset) --
update sector s set competition_id = r.competition_id from round r where s.round_id = r.id and s.competition_id is null;
update round_entry e set competition_id = r.competition_id from round r where e.round_id = r.id and e.competition_id is null;
update scorecard sc set competition_id = r.competition_id from round r where sc.round_id = r.id and sc.competition_id is null;
update claim cl set competition_id = r.competition_id from round r where cl.round_id = r.id and cl.competition_id is null;
update catch c set competition_id = sc.competition_id from scorecard sc where c.scorecard_id = sc.id and c.competition_id is null;
update scorecard_photo p set competition_id = sc.competition_id from scorecard sc where p.scorecard_id = sc.id and p.competition_id is null;
update audit_log a set competition_id = r.competition_id from round r where a.round_id = r.id and a.competition_id is null;

alter table sector alter column competition_id set not null;
alter table round_entry alter column competition_id set not null;
alter table scorecard alter column competition_id set not null;
alter table catch alter column competition_id set not null;
alter table scorecard_photo alter column competition_id set not null;
alter table claim alter column competition_id set not null;

-- 6) Rewrite the operational tables' write policies to membership-via-competition
drop policy if exists "committee write round" on round;
create policy "member writes round" on round for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee write sector" on sector;
create policy "member writes sector" on sector for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee write entry" on round_entry;
create policy "member writes entry" on round_entry for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "organizers write lot" on lot;
create policy "member writes lot" on lot for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee write pair" on pair;
create policy "member writes pair" on pair for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee write scorecard" on scorecard;
create policy "member writes scorecard" on scorecard for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee write catch" on catch;
create policy "member writes catch" on catch for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee photo" on scorecard_photo;
create policy "member writes photo" on scorecard_photo for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee write claim" on claim;
create policy "member writes claim" on claim for all
  to authenticated using (is_competition_mine(competition_id)) with check (is_competition_mine(competition_id));

drop policy if exists "committee insert audit" on audit_log;
create policy "member inserts audit" on audit_log for insert
  to authenticated with check (competition_id is null or is_competition_mine(competition_id));

-- 7) Drop the now-unused club_id from the operational tables ------------------
-- (Dropping the column also drops its FK to club and its index.)
alter table round drop column club_id;
alter table sector drop column club_id;
alter table round_entry drop column club_id;
alter table lot drop column club_id;
alter table pair drop column club_id;
alter table scorecard drop column club_id;
alter table catch drop column club_id;
alter table scorecard_photo drop column club_id;
alter table claim drop column club_id;
alter table audit_log drop column club_id;
