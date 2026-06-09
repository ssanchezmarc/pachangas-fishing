-- Issue 28 — Competition lifecycle (distinct from the per-round status).
-- States: draft → open → in_progress → provisional → final → closed.
-- Transitions are free in any direction for now (no restriction); each change is
-- audited. Public visibility: only open / in_progress / provisional / final are
-- listed/opened to the public; draft and closed stay organizers-only.

create type competition_status as enum (
  'draft', 'open', 'in_progress', 'provisional', 'final', 'closed'
);

alter table competition
  add column status competition_status not null default 'draft';
