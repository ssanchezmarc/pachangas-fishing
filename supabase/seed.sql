-- Development seed: a single club (v1) and the real reference competition.
-- Idempotent by id so it can be re-run locally.

insert into club (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Pachangas Fishing Club')
on conflict (id) do nothing;

insert into competition (id, club_id, name, type, status)
values (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'VII Liga Duos Alto Carrión 2026',
  'pairs',
  'in_progress'
)
on conflict (id) do nothing;

insert into round (id, club_id, competition_id, name, date, start_time, end_time, status)
values (
  '00000000-0000-0000-0000-000000000100',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  'Round 7',
  '2026-06-07',
  '15:45',
  '17:45',
  'open'
)
on conflict (id) do nothing;
