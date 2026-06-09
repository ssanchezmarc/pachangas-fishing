-- Bootstrap — v1 is single-club (PRD §5): ensure a default club exists so the
-- organizers' admin (clubId(): `select id from club limit 1`) can create
-- competitions on a freshly provisioned database. Idempotent.
insert into club (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Pachangas Fishing Club')
on conflict (id) do nothing;
