-- Issue 16 — Competition type: individual or pairs.
-- A competition is either individual or pairs (not both). The type is defined at
-- the competition level and decides which standings are computed and shown. The
-- Alto Carrión preset is a "Liga Duos" → pairs.

create type competition_type as enum ('individual', 'pairs');

alter table competition
  add column type competition_type not null default 'pairs';
