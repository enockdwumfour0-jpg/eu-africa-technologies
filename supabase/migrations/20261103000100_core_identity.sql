-- 001: identity, roles, client accounts, audit log
-- Existing objects kept: public.admins, private.is_admin(), enquiries, land_listings, gallery_items.

create type public.app_role as enum
  ('super_admin','admin','project_manager','accountant','support_officer','client');
create type public.account_status as enum ('pending','active','rejected','suspended');

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  company text check (company is null or char_length(company) <= 160),
  avatar_path text,
  status public.account_status not null default 'pending',
  notification_prefs jsonb not null default '{"email":true,"in_app":true}'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_status_idx on public.profiles(status);

-- One role per user. No client-writable policy exists: roles change only via RPCs.
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index user_roles_role_idx on public.user_roles(role);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text check (company_name is null or char_length(company_name) <= 160),
  address text check (address is null or char_length(address) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  company text,
  address text,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now()
);
create index client_applications_status_idx on public.client_applications(status);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_table_idx on public.audit_logs(table_name, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id);

create trigger profiles_updated before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger clients_updated before update on public.clients
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- helpers
-- Role resolves only for ACTIVE accounts, so suspending a user removes all access.
create or replace function private.user_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select ur.role from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.status = 'active'
$$;

create or replace function private.has_role(variadic r public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() = any (r), false)
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('super_admin','admin','project_manager','accountant','support_officer')
$$;

create or replace function private.is_admin_or_above() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('super_admin','admin')
$$;

create or replace function private.my_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clients c
  join public.profiles p on p.id = c.profile_id
  where c.profile_id = auth.uid() and p.status = 'active'
$$;

-- Legacy website admin (enquiries, lands, gallery): keep the email allow-list
-- and additionally accept active admin / super_admin accounts.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or private.is_admin_or_above();
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------- audit
create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        j_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
begin
  insert into public.audit_logs(actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(j_new ->> 'id', j_new ->> 'user_id', j_old ->> 'id', j_old ->> 'user_id'),
          j_old, j_new);
  return coalesce(new, old);
end $$;

create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function private.audit();
create trigger audit_profiles after update on public.profiles
  for each row when (old.status is distinct from new.status) execute function private.audit();
create trigger audit_client_apps after update on public.client_applications
  for each row execute function private.audit();

-- ---------------------------------------------------------------- guards
-- Users may edit their own contact fields; status / approval fields are admin-only.
create or replace function private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_admin_or_above() then
    if new.status is distinct from old.status
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'Not allowed to change account status or identity fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile();

-- ---------------------------------------------------------------- signup
-- Public sign-ups are ALWAYS role 'client', status 'pending'. Role can only be
-- pre-set through app_metadata, which only the service role can write.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.app_role := 'client';
begin
  begin
    if new.raw_app_meta_data ->> 'provisioned_role' is not null then
      r := (new.raw_app_meta_data ->> 'provisioned_role')::public.app_role;
    end if;
  exception when others then r := 'client';
  end;

  insert into public.profiles(id, email, full_name, phone, company, status)
  values (new.id, new.email,
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
          left(new.raw_user_meta_data ->> 'phone', 40),
          left(new.raw_user_meta_data ->> 'company', 160),
          case when r = 'client' then 'pending' else 'active' end::public.account_status);

  insert into public.user_roles(user_id, role) values (new.id, r);

  if r = 'client' then
    insert into public.clients(profile_id, company_name)
    values (new.id, left(new.raw_user_meta_data ->> 'company', 160));
    insert into public.client_applications(user_id, company, address, notes)
    values (new.id, left(new.raw_user_meta_data ->> 'company', 160),
            left(new.raw_user_meta_data ->> 'address', 300),
            left(new.raw_user_meta_data ->> 'notes', 1000));
    -- queued for the "successful registration" email (sent by the send-notification-email function)
    perform private.notify(new.id, 'registration_received', 'Registration received',
      'Thank you for registering. Please verify your email address. An administrator will then review and approve your account.', null);
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill: existing website admin(s) become active super administrators.
insert into public.profiles(id, email, full_name, status, approved_at)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', ''), 'active', now()
from auth.users u join public.admins a on lower(a.email) = lower(u.email)
on conflict (id) do nothing;
insert into public.user_roles(user_id, role)
select u.id, 'super_admin' from auth.users u join public.admins a on lower(a.email) = lower(u.email)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- RPCs
create or replace function public.review_client_application(p_user uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin_or_above() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  if not exists (select 1 from public.user_roles where user_id = p_user and role = 'client') then
    raise exception 'Not a client account';
  end if;
  update public.profiles set
    status = case when p_decision = 'approved' then 'active' else 'rejected' end::public.account_status,
    approved_by = auth.uid(), approved_at = now(),
    rejection_reason = case when p_decision = 'rejected' then left(p_note, 500) end
  where id = p_user;
  update public.client_applications set status = p_decision, reviewed_by = auth.uid(),
    reviewed_at = now(), review_note = left(p_note, 500) where user_id = p_user;
end $$;

create or replace function public.set_account_status(p_user uuid, p_status public.account_status)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.app_role;
begin
  if not private.is_admin_or_above() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status'; end if;
  select role into target from public.user_roles where user_id = p_user;
  -- only a super administrator may touch staff accounts
  if target is distinct from 'client' and not private.has_role('super_admin') then
    raise exception 'Only a super administrator can change staff accounts' using errcode = '42501';
  end if;
  update public.profiles set status = p_status where id = p_user;
end $$;

create or replace function public.set_user_role(p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('super_admin') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role = 'client' then raise exception 'Use client approval for client accounts'; end if;
  insert into public.user_roles(user_id, role, assigned_by) values (p_user, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, assigned_by = auth.uid();
end $$;

revoke all on function public.review_client_application, public.set_account_status, public.set_user_role from public, anon;
grant execute on function public.review_client_application, public.set_account_status, public.set_user_role to authenticated;
