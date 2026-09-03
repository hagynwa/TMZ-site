-- Originals stay private: an unapproved submission must not be guessable by URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tmz-photo-originals', 'tmz-photo-originals', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- Derivatives are generated only after approval, so this bucket is safe to serve.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tmz-photo-public', 'tmz-photo-public', true, 10485760,
        array['image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "tmz submit to originals" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tmz-photo-originals');

create policy "tmz staff read originals" on storage.objects
  for select to authenticated
  using (bucket_id = 'tmz-photo-originals' and tmz_is_staff());

create policy "tmz world reads derivatives" on storage.objects
  for select using (bucket_id = 'tmz-photo-public');
