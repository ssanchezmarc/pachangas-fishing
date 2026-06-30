-- Issues 45 + 50 — Competition visibility/access code and richer sector identity.
--
--  * #45: a competition is public or private (orthogonal to its lifecycle status).
--    Public ones are listed on the home and openly accessible; private ones are
--    hidden and only reachable with an access code the organizers hand out. The
--    code stops being required once the competition is made public.
--  * #50: a sector is identified by three fields — river + venue (escenario/coto) +
--    sector name — instead of a single name.

-- 1) #45 — visibility + access code on competition.
alter table competition
  add column visibility text not null default 'public'
    check (visibility in ('public', 'private'));
alter table competition add column access_code text;

-- Backfill a code for every existing competition so toggling to private just works.
update competition
  set access_code = upper(substr(md5(random()::text || id::text), 1, 8))
  where access_code is null;

-- The code identifies a competition for code-based access, so it must be unique.
create unique index competition_access_code_key
  on competition (access_code)
  where access_code is not null;

-- 2) #50 — sector gains river + venue (escenario/coto); `name` stays as the sector
--    label. Default '' on existing rows so the composite uniqueness is meaningful.
alter table sector add column river text not null default '';
alter table sector add column venue text not null default '';
alter table sector drop constraint if exists sector_competition_id_name_key;
alter table sector
  add constraint sector_competition_river_venue_name_key
  unique (competition_id, river, venue, name);
