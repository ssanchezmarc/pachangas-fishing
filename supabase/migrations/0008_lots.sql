-- Issue 20 — Lots replace the loose bib.
-- A `lot` is the number drawn in the sorteo, scoped to a competition; it is what
-- determines which rounds and sectors an angler fishes/controls. Each angler draws
-- their own lot (even in a pairs competition every member has their own scorecard,
-- issue 21; the pair is composed afterwards for the standings).
--
-- The per-round participation (`round_entry`) is now derived from the lot: it no
-- longer carries a loose bib, but references the lot, the sector fished, and which
-- lot it controls in that round (so the fish/control role inversion of grouped
-- rounds, issue 18, is just different rows per round).

create table lot (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club (id) on delete cascade,
  competition_id uuid not null references competition (id) on delete cascade,
  number int not null,
  angler_id uuid not null references angler (id),
  unique (competition_id, number),
  unique (competition_id, angler_id)
);
create index on lot (club_id);
create index on lot (competition_id);

alter table lot enable row level security;
create policy "public read lot" on lot for select using (true);
create policy "organizers write lot" on lot for all
  to authenticated using (true) with check (true);

-- round_entry becomes the lot's participation in a round: sector fished + who it
-- controls (another lot). bib / angler_id / controls_angler_id are replaced.
alter table round_entry drop constraint if exists round_entry_round_id_bib_key;
alter table round_entry drop constraint if exists round_entry_round_id_angler_id_key;

alter table round_entry add column lot_id uuid references lot (id) on delete cascade;
alter table round_entry add column controls_lot_id uuid references lot (id);

alter table round_entry drop column bib;
alter table round_entry drop column controls_angler_id;
alter table round_entry drop column angler_id;

alter table round_entry alter column lot_id set not null;
alter table round_entry add constraint round_entry_round_lot_key unique (round_id, lot_id);
