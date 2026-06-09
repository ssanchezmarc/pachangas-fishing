-- Issue 18 — Grouping rounds for the standings (typically two-by-two).
-- Rounds are normally grouped in pairs: the 1st and 2nd round form a group where
-- each participant fishes one round and controls in the other (the fish/control
-- roles invert between the two rounds). The relevant standing is the group's,
-- aggregating its rounds with the same FEPyC sum-of-placings engine.
--
-- Modelled as a nullable group index on the round: rounds of the same competition
-- sharing a non-null group_index belong to the same group; null = ungrouped
-- (the round stands on its own). No separate table is needed for the default
-- two-by-two pairing.

alter table round add column group_index int;

create index on round (competition_id, group_index);
