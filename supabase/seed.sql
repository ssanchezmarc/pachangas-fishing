-- Development seed (issue 29 — multi-club). Run after `supabase db reset`.
--
-- Creates a ready-to-use dev environment:
--   • a dev organizer in Supabase Auth   →  login: organizer@pachangas.local / pachangas123
--   • an example club owned by that organizer (club_member)
--   • the real reference competition + one round, hanging off the club
--
-- Idempotent by id. NOTE: seeding auth.users/auth.identities is gotrue-version
-- sensitive; if a `db reset` errors here, create the user in Supabase Studio
-- (Auth → Users) and keep the club_member insert pointing at its UUID instead.

-- 1) Dev organizer in Supabase Auth.
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- GoTrue scans these as non-null strings: seed them as '' (NULL breaks
  -- `admin.listUsers` with "converting NULL to string is unsupported").
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000aa',
  'authenticated', 'authenticated', 'organizer@pachangas.local',
  crypt('pachangas123', gen_salt('bf')), now(),
  now(), now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-0000000000aa',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","email":"organizer@pachangas.local"}',
  'email', '00000000-0000-0000-0000-0000000000aa',
  now(), now(), now()
)
on conflict do nothing;

-- 2) Example club, owned by the dev organizer.
insert into club (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Pachangas Fishing Club')
on conflict (id) do nothing;

insert into club_member (club_id, user_id, role)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000aa',
  'owner'
)
on conflict (club_id, user_id) do nothing;

-- 3) Reference competition + a round (competition is the only thing under the club).
insert into competition (id, club_id, name, type, status)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'VII Liga Duos Alto Carrión 2026',
  'pairs',
  'in_progress'
)
on conflict (id) do nothing;

insert into round (id, competition_id, name, date, start_time, end_time, status)
values (
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000010',
  'Round 7',
  '2026-06-07',
  '15:45',
  '17:45',
  'open'
)
on conflict (id) do nothing;

-- 4) Coherent example for the new lots model (issues 41/42/43):
--    competition-level sectors + two anglers forming a pair + lots + the draw
--    (one lot per pair) + a per-round pattern (fish in sector A).
insert into sector (id, competition_id, name) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000010', 'A'),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-000000000010', 'B')
on conflict (id) do nothing;

insert into angler (id, competition_id, name, license_number) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000010', 'Ana Río', 'LIC-001'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000010', 'Luis Vega', 'LIC-002')
on conflict (id) do nothing;

insert into pair (id, competition_id, name, angler1_id, angler2_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000010', 'Ana & Luis',
   '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')
on conflict (id) do nothing;

-- Lots defined (numbers), then the draw assigns lot 17 to the pair.
insert into lot (id, competition_id, number, pair_id) values
  ('00000000-0000-0000-0000-00000000170c', '00000000-0000-0000-0000-000000000010', 17,
   '00000000-0000-0000-0000-0000000000f1')
on conflict (id) do nothing;

-- The lot's per-round pattern: in Round 7 it fishes sector A.
insert into round_entry (id, round_id, lot_id, role, sector_id) values
  ('00000000-0000-0000-0000-00000000170e', '00000000-0000-0000-0000-000000000100',
   '00000000-0000-0000-0000-00000000170c', 'fish', '00000000-0000-0000-0000-0000000005a1')
on conflict (id) do nothing;
