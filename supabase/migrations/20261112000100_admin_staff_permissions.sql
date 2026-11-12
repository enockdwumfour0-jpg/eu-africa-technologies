-- 017: Administrators may manage non-admin staff, but the website, online-payment setup and
-- finance/email system settings stay with the Super Administrator.

-- ---------------------------------------------------------------- website editing: super administrator only
create or replace function private.is_site_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('super_admin') or exists (
    select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

drop policy if exists site_content_ins on public.site_content;
drop policy if exists site_content_upd on public.site_content;
drop policy if exists site_content_del on public.site_content;
create policy site_content_ins on public.site_content for insert to authenticated with check (private.has_role('super_admin'));
create policy site_content_upd on public.site_content for update to authenticated using (private.has_role('super_admin')) with check (private.has_role('super_admin'));
create policy site_content_del on public.site_content for delete to authenticated using (private.has_role('super_admin'));

drop policy if exists team_ins on public.team_members;
drop policy if exists team_upd on public.team_members;
drop policy if exists team_del on public.team_members;
create policy team_ins on public.team_members for insert to authenticated with check (private.has_role('super_admin'));
create policy team_upd on public.team_members for update to authenticated using (private.has_role('super_admin')) with check (private.has_role('super_admin'));
create policy team_del on public.team_members for delete to authenticated using (private.has_role('super_admin'));

drop policy if exists "admins insert land" on public.land_listings;
drop policy if exists "admins update land" on public.land_listings;
drop policy if exists "admins delete land" on public.land_listings;
create policy "admins insert land" on public.land_listings for insert with check (private.is_site_editor());
create policy "admins update land" on public.land_listings for update using (private.is_site_editor()) with check (private.is_site_editor());
create policy "admins delete land" on public.land_listings for delete using (private.is_site_editor());

drop policy if exists "admins insert gallery" on public.gallery_items;
drop policy if exists "admins update gallery" on public.gallery_items;
drop policy if exists "admins delete gallery" on public.gallery_items;
create policy "admins insert gallery" on public.gallery_items for insert with check (private.is_site_editor());
create policy "admins update gallery" on public.gallery_items for update using (private.is_site_editor()) with check (private.is_site_editor());
create policy "admins delete gallery" on public.gallery_items for delete using (private.is_site_editor());

drop policy if exists "admins upload gallery photos" on storage.objects;
drop policy if exists "admins update gallery photos" on storage.objects;
drop policy if exists "admins delete gallery photos" on storage.objects;
create policy "admins upload gallery photos" on storage.objects for insert with check (bucket_id = 'gallery' and private.is_site_editor());
create policy "admins update gallery photos" on storage.objects for update using (bucket_id = 'gallery' and private.is_site_editor());
create policy "admins delete gallery photos" on storage.objects for delete using (bucket_id = 'gallery' and private.is_site_editor());

-- ---------------------------------------------------------------- settings: admins keep company + notifications only
drop policy if exists settings_insert on public.app_settings;
drop policy if exists settings_update on public.app_settings;
create policy settings_insert on public.app_settings for insert to authenticated
  with check (private.has_role('super_admin') or (private.is_admin_or_above() and key in ('company', 'notifications')));
create policy settings_update on public.app_settings for update to authenticated
  using (private.has_role('super_admin') or (private.is_admin_or_above() and key in ('company', 'notifications')))
  with check (private.has_role('super_admin') or (private.is_admin_or_above() and key in ('company', 'notifications')));

-- ---------------------------------------------------------------- staff management
-- An administrator may manage project managers, accountants, support officers and agents.
-- Only the super administrator can create, change or suspend administrators and other super administrators.
create or replace function private.can_manage_staff_role(target public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('super_admin')
      or (private.has_role('admin') and target in ('project_manager', 'accountant', 'support_officer', 'agent'))
$$;

create or replace function public.set_account_status(p_user uuid, p_status public.account_status) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.app_role;
begin
  if not private.is_admin_or_above() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status'; end if;
  select role into target from public.user_roles where user_id = p_user;
  if target is distinct from 'client' and not private.can_manage_staff_role(target) then
    raise exception 'Only a super administrator can change administrator accounts' using errcode = '42501';
  end if;
  update public.profiles set status = p_status where id = p_user;
end $$;

create or replace function public.set_user_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
declare cur public.app_role;
begin
  if not private.is_admin_or_above() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role = 'client' then raise exception 'Use client approval for client accounts'; end if;
  select role into cur from public.user_roles where user_id = p_user;
  if cur is null or cur = 'client' then raise exception 'That is not a staff account'; end if;
  if not (private.can_manage_staff_role(cur) and private.can_manage_staff_role(p_role)) then
    raise exception 'Only a super administrator can grant or change administrator access' using errcode = '42501';
  end if;
  if p_role = 'agent' or cur = 'agent' then raise exception 'Agent accounts are managed on the Agents page'; end if;
  insert into public.user_roles(user_id, role, assigned_by) values (p_user, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, assigned_by = auth.uid();
end $$;

create or replace function public.set_staff_title(p_user uuid, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
declare t text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]<>]', '', 'g')), ''); cur public.app_role;
begin
  if not private.is_admin_or_above() then raise exception 'Forbidden' using errcode = '42501'; end if;
  select role into cur from public.user_roles where user_id = p_user;
  if cur is null or cur = 'client' then raise exception 'That is not a staff account'; end if;
  if not private.can_manage_staff_role(cur) and p_user <> auth.uid() then
    raise exception 'Only a super administrator can edit administrator accounts' using errcode = '42501';
  end if;
  if t is not null and char_length(t) > 80 then raise exception 'Position is too long (80 characters maximum)'; end if;
  update public.profiles set job_title = t where id = p_user;
end $$;
