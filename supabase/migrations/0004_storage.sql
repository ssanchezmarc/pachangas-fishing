-- Slice 03 — Private bucket for scorecard photos (evidence, RNF-5).
-- The bucket is NOT public: photos are served only via a signed URL to the committee.

insert into storage.buckets (id, name, public)
values ('scorecards', 'scorecards', false)
on conflict (id) do nothing;

-- Only the authenticated committee can upload/read objects in the bucket.
create policy "committee uploads scorecard photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'scorecards');

create policy "committee reads scorecard photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'scorecards');
