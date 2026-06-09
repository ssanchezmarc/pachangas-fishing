-- Issue 25 — Claims hang off a scorecard, not the round at large.
-- scorecard_id becomes mandatory; a claim is deleted with its scorecard.

delete from claim where scorecard_id is null;

alter table claim drop constraint if exists claim_scorecard_id_fkey;
alter table claim alter column scorecard_id set not null;
alter table claim
  add constraint claim_scorecard_fk
  foreign key (scorecard_id) references scorecard (id) on delete cascade;

create index on claim (scorecard_id);
