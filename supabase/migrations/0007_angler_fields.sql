-- Issue 19 — Angler details: license, federation number, phone.
-- name + license_number are mandatory; federation_number and phone are optional
-- for now (phone will feed the WhatsApp whitelist / controller identification in
-- Phase 2). License is unique within a club.

alter table angler add column license_number text;
alter table angler add column federation_number text;
alter table angler add column phone text;

-- Backfill any pre-existing rows so the not-null + unique constraints can apply
-- (fresh local DBs have none; this keeps `db reset` idempotent on populated ones).
update angler
  set license_number = 'LIC-' || left(id::text, 8)
  where license_number is null;

alter table angler alter column license_number set not null;

create unique index angler_license_per_club on angler (club_id, license_number);
