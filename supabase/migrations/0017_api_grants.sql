-- Issue (infra) — Grant table/sequence privileges to the PostgREST API roles.
--
-- The schema relies on Row Level Security to protect rows: every app table has
-- RLS enabled with explicit policies (public reads open, writes gated by club
-- membership). But RLS only filters rows AFTER PostgreSQL's table-level
-- privilege check passes — and these privileges were never granted, so every
-- request through the API (anon, authenticated and the service-role queue) hit
-- "permission denied for table …".
--
-- Supabase normally auto-grants these via ALTER DEFAULT PRIVILEGES on the
-- internal roles; that default did not apply to the tables created by these
-- migrations, so we grant them explicitly here. This is the standard Supabase
-- posture: roles hold privileges, RLS does the gating. `service_role` has
-- BYPASSRLS, so it needs the grants to run the WhatsApp/Inngest queue.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

-- Future tables/sequences in public inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences
  to anon, authenticated, service_role;
