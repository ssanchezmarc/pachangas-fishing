-- Slice 12 — Claims and immutable audit log.
-- Round lifecycle: open → provisional (appeals window) → final (immutable). Every
-- correction and claim resolution is recorded in the audit log with author and
-- timestamp (RNF-4).

create type claim_status as enum ('open', 'resolved', 'rejected');

create table claim (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  round_id uuid not null references round (id) on delete cascade,
  scorecard_id uuid references scorecard (id) on delete set null,
  -- Who claims (free text: bib, name or number). v1 has no participant login.
  author text not null,
  reason text not null,
  status claim_status not null default 'open',
  resolution text,
  resolved_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on claim (club_id);
create index on claim (round_id);

-- Audit log: insert and read only (immutable). No update/delete policies.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  round_id uuid references round (id) on delete set null,
  entity text not null,          -- 'round' | 'scorecard' | 'claim'
  entity_id uuid,
  action text not null,          -- 'status_transition' | 'scorecard_correction' | 'claim_resolution' ...
  author text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log (club_id);
create index on audit_log (round_id);

alter table claim enable row level security;
alter table audit_log enable row level security;

-- Claims are publicly readable (transparency); the committee registers them in v1.
create policy "public read claim" on claim for select using (true);
create policy "committee write claim" on claim for all
  to authenticated using (true) with check (true);

-- Audit log: public read (transparency), insert only by the committee, never update/delete.
create policy "public read audit" on audit_log for select using (true);
create policy "committee insert audit" on audit_log for insert
  to authenticated with check (true);
