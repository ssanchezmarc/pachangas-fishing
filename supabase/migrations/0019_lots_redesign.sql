-- Issues 41/42/43 — Lots redesign (design closed in grill-me 2026-06-17).
--
-- New model:
--  * sector is a competition-level reusable LABEL (name may be composite like
--    "17/18/19"); it no longer hangs off a round.
--  * round_entry is the lot's per-round PATTERN: (round, lot, role, sector). Both
--    roles carry a sector now; the old controls_lot_id is gone (a controller is
--    posted to a sector, not assigned to a specific lot).
--  * a lot can be defined before the draw (angler_id nullable) and the draw assigns
--    it to an angler (individual) or a pair (pairs) — one lot per pair.
--  * each plica is attributed to the member who turned it in (scorecard.angler_id),
--    since in pairs a single lot is shared by the two members (FEPyC sum of both).
--
-- Clean restructure (pre-launch): the operational test data tied to the old
-- per-round sector / lot model is discarded. Clubs, competitions, rounds, anglers
-- and pairs are kept; sectors, lots, entries and scorecards are re-created (seed).

-- 0) Discard operational data tied to the old model (cascades to round_entry,
--    scorecard, catch, scorecard_photo, claim, audit_log).
truncate table lot, sector restart identity cascade;

-- 1) Sectors move from round level to a competition-level reusable catalog.
drop trigger if exists trg_sector_competition on sector;
alter table sector drop constraint if exists sector_round_id_name_key;
alter table sector drop column round_id;
alter table sector add constraint sector_competition_id_name_key unique (competition_id, name);

-- 2) round_entry is the lot's per-round pattern: (round, lot, role, sector).
alter table round_entry drop constraint if exists round_entry_role_shape;
alter table round_entry drop column controls_lot_id;
alter table round_entry alter column sector_id set not null;

-- 3) The draw is recorded later: a lot exists before being assigned, and in pairs
--    one lot is assigned to the whole pair.
alter table lot alter column angler_id drop not null;
alter table lot add column pair_id uuid references pair (id) on delete set null;
create index on lot (pair_id);
-- One lot per number again: a pair now shares ONE lot (issue 40/43), so the number
-- is unique within the competition (it stopped being unique in 0016 when a pair
-- created two lots with the same number).
alter table lot add constraint lot_competition_id_number_key unique (competition_id, number);

-- 4) Attribute each plica to its member (the angler who turned it in). In an
--    individual competition this equals the lot's drawn angler; in pairs it is the
--    member whose plica this is, so the two members' results sum (FEPyC).
alter table scorecard add column angler_id uuid references angler (id);
create index on scorecard (angler_id);
-- One plica per (round, entry, member): in pairs the two members share one lot
-- (one entry) and each turns in their own plica, so the old unique(round, entry)
-- would reject the second member. Key it by the member instead.
alter table scorecard drop constraint if exists scorecard_round_id_entry_id_key;
alter table scorecard add constraint scorecard_round_entry_member_key unique (round_id, entry_id, angler_id);
