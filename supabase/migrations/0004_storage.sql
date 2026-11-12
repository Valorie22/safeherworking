-- =====================================================================
-- SafeHer — 0004_storage.sql
-- Buckets for evidence and avatars.
--
-- Path convention, relied on by every app and by the policies below:
--   incident-media/{incident_id}/{audio|photo}/{timestamp}.{ext}
--   avatars/{user_id}.jpg
-- The first path segment IS the incident id. That is what lets one
-- policy reuse can_see_incident() instead of duplicating the matrix.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('incident-media', 'incident-media', false, 26214400,
   array['audio/m4a','audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/wav',
         'image/jpeg','image/png','image/webp','video/mp4']),
  ('avatars', 'avatars', true, 5242880,
   array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- incident-media — private. Responders reach it by signed URL, which
-- the dashboard mints per object; the signature is only issued because
-- this policy let the row be read in the first place.
-- ---------------------------------------------------------------------

create policy incident_media_read on storage.objects
  for select using (
    bucket_id = 'incident-media'
    and can_see_incident(((storage.foldername(name))[1])::uuid)
  );

-- Only the citizen whose incident it is may upload evidence to it.
create policy incident_media_insert_citizen on storage.objects
  for insert with check (
    bucket_id = 'incident-media'
    and exists (
      select 1 from incidents i
       where i.id = ((storage.foldername(name))[1])::uuid
         and i.user_id = auth.uid()
    )
  );

-- Push-to-talk from the control room and from a guardian lands here too.
create policy incident_media_insert_participant on storage.objects
  for insert with check (
    bucket_id = 'incident-media'
    and (storage.foldername(name))[2] = 'ptt'
    and can_see_incident(((storage.foldername(name))[1])::uuid)
  );

-- Evidence is never edited or deleted from the client. Retention is a
-- server-side policy decision, not a user action.


-- ---------------------------------------------------------------------
-- avatars — public read, owner write.
-- ---------------------------------------------------------------------

create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_write_own on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
