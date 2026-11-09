-- 006: private storage buckets + policies, realtime publication

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documents', 'documents', false, 20971520, array['application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png']),
  ('project-photos', 'project-photos', false, 10485760, array['image/jpeg','image/png']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png']),
  ('message-attachments', 'message-attachments', false, 10485760, array['application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Path conventions (first folder segment is the owner key):
--   documents/<client_id>/<file>   project-photos/<project_id>/<file>
--   avatars/<user_id>/<file>       message-attachments/<thread_id>/<file>
create or replace function private.is_uuid(t text) returns boolean
language sql immutable set search_path = '' as $$
  select t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
grant execute on function private.is_uuid(text) to authenticated;

-- documents: read follows the documents table's own RLS (subquery runs as the caller)
create policy docs_obj_select on storage.objects for select to authenticated using (
  bucket_id = 'documents'
  and exists (select 1 from public.documents d where d.storage_path = storage.objects.name));
create policy docs_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'documents' and private.is_uuid((storage.foldername(name))[1]) and (
    (storage.foldername(name))[1] = private.my_client_id()::text
    or private.is_admin_or_above()
    or private.has_role('project_manager')));
create policy docs_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'documents' and private.is_admin_or_above());

-- project photos: visible when the owning update is visible to the caller
create policy photos_obj_select on storage.objects for select to authenticated using (
  bucket_id = 'project-photos'
  and exists (select 1 from public.project_updates u where storage.objects.name = any (u.photo_paths)));
create policy photos_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'project-photos' and private.is_uuid((storage.foldername(name))[1])
  and private.can_manage_project(((storage.foldername(name))[1])::uuid));
create policy photos_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'project-photos' and private.is_uuid((storage.foldername(name))[1])
  and private.can_manage_project(((storage.foldername(name))[1])::uuid));

-- avatars: own folder; office staff may view
create policy avatars_obj_select on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_staff()));
create policy avatars_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_obj_update on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- message attachments: anyone who can access the thread
create policy msgfiles_obj_select on storage.objects for select to authenticated using (
  bucket_id = 'message-attachments' and private.is_uuid((storage.foldername(name))[1])
  and private.can_access_thread(((storage.foldername(name))[1])::uuid));
create policy msgfiles_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'message-attachments' and private.is_uuid((storage.foldername(name))[1])
  and private.can_access_thread(((storage.foldername(name))[1])::uuid));

-- realtime (RLS still applies to every change event)
alter publication supabase_realtime add table public.messages, public.notifications;
