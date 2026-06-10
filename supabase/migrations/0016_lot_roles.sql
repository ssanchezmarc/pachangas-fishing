-- Issue 35 — Redefine the lot: a set of fish-rounds + a set of control-rounds.
--
-- A lot (competition, number, angler) now defines, per round, its ROLE: it either
-- fishes a sector or controls another lot. This replaces defining fish/control ad
-- hoc and supports the role inversion between the rounds of a phase (#18/#31): a
-- lot fishes round 1 and controls round 2; its paired lot does the inverse.
--
-- lot ↔ sector decision (closed in grill-me, 2026-06-09): sectors are defined
-- first and then assigned to a lot's fishing role per round. So a `fish` entry
-- carries its sector; a `control` entry carries the controlled lot.
--
-- Pairs (issue 35): the two members of a pair draw a lot with the SAME number, so
-- the lot number is no longer unique within a competition (still one lot per angler).

-- 1) Per-round role on the participation row.
create type round_role as enum ('fish', 'control');
alter table round_entry add column role round_role not null default 'fish';

-- A controller does not fish a sector; a fisher does not control a lot. The sector
-- becomes optional (null on control rows).
alter table round_entry alter column sector_id drop not null;
alter table round_entry
  add constraint round_entry_role_shape
  check (
    (role = 'fish' and sector_id is not null)
    or (role = 'control' and controls_lot_id is not null)
  );

-- 2) A pair shares a lot number → number is no longer unique on its own.
alter table lot drop constraint if exists lot_competition_id_number_key;
-- (unique (competition_id, angler_id) stays: one lot per angler.)
