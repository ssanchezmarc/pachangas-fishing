-- Issue 37 — Organizers manage their clubs' membership (co-organizers).
--
-- The original policy let an organizer read only their OWN club_member row, so the
-- club page could not list the other organizers. Replace it with a club-scoped read:
-- a caller can see every membership of a club they belong to (is_club_member).
--
-- Adding/removing OTHER organizers is done with the service-role client from server
-- actions (after a membership check), which bypasses RLS — so no broad insert/delete
-- policies are added here. The self-enroll insert policy stays (createClub uses it).
drop policy if exists "member reads own memberships" on club_member;
create policy "members read club memberships" on club_member for select
  to authenticated using (is_club_member(club_id));
