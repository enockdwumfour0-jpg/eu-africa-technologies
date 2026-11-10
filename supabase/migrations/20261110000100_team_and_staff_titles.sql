-- 015: staff positions (job titles) and a manageable team list for the public site.
-- Both are additive: nothing existing changes behaviour.

-- ---------------------------------------------------------------- staff position
-- The access ROLE (what a person may do) stays one of the fixed roles because the database enforces it.
-- The POSITION is free text, so any job title can be given without changing permissions.
alter table public.profiles
  add column if not exists job_title text check (job_title is null or char_length(job_title) <= 80);

-- Only administrators may change job titles (a user could otherwise label themselves "Director").
create or replace function private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_admin_or_above() then
    if new.status is distinct from old.status
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.email is distinct from old.email
       or new.job_title is distinct from old.job_title
       or new.id is distinct from old.id then
      raise exception 'Not allowed to change account status or identity fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.set_staff_title(p_user uuid, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
declare t text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]<>]', '', 'g')), '');
begin
  if not private.has_role('super_admin') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_roles where user_id = p_user and role <> 'client') then
    raise exception 'That is not a staff account';
  end if;
  if t is not null and char_length(t) > 80 then raise exception 'Position is too long (80 characters maximum)'; end if;
  update public.profiles set job_title = t where id = p_user;
end $$;
revoke all on function public.set_staff_title(uuid, text) from public, anon;
grant execute on function public.set_staff_title(uuid, text) to authenticated;

-- ---------------------------------------------------------------- team members
-- Shown on the public "Our team" page. Administrators add, edit, hide and delete them from the dashboard.
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  title text not null default '' check (char_length(title) <= 160),
  section text not null check (section in ('leadership', 'team', 'group')),
  photo_url text check (photo_url is null
    or photo_url ~ '^img/team-[a-z0-9-]+\.jpg$'
    or photo_url ~ '^https://enlkrucktzppkyxrljpr\.supabase\.co/storage/v1/object/public/gallery/team/[A-Za-z0-9._-]+$'),
  sort_order integer not null default 100,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index team_members_order_idx on public.team_members(section, sort_order);
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;
grant select on public.team_members to anon, authenticated;
grant insert, update, delete on public.team_members to authenticated;
create policy team_read on public.team_members for select to anon, authenticated
  using (published or private.is_admin_or_above());
create policy team_ins on public.team_members for insert to authenticated with check (private.is_admin_or_above());
create policy team_upd on public.team_members for update to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());
create policy team_del on public.team_members for delete to authenticated using (private.is_admin_or_above());
create trigger team_members_updated before update on public.team_members
  for each row execute function private.set_updated_at();
create trigger audit_team_members after insert or update or delete on public.team_members
  for each row execute function private.audit();

-- Current team, in page order (Frank Mensah is intentionally not included).
insert into public.team_members (name, title, section, photo_url, sort_order) values
  ('Mr. Kada Faisel', 'Executive Director', 'leadership', 'img/team-kada-faisel.jpg', 10),
  ('Mr. Enock Dwumfour', 'Sales & Trade Director', 'leadership', 'img/team-enock-dwumfour.jpg', 20),
  ('Mrs. Christina Kyerewaa', 'General Administrator', 'leadership', 'img/team-christina-kyerewaa.jpg', 30),
  ('Jonathan Baumann', 'Executive Assistant', 'team', 'img/team-jonathan-baumann.jpg', 10),
  ('Aina Cárceles', 'Senior Technical Engineer & Advisor', 'team', 'img/team-aina-carceles.jpg', 20),
  ('Freda Stephanie Essel', 'Sales & Admin Manager', 'team', 'img/team-freda-stephanie-essel.jpg', 30),
  ('Robert Baah Yawson', 'Technical Director', 'team', 'img/team-robert-baah-yawson.jpg', 40),
  ('Majorie Naa Ayorkor Mensah', 'Commercial Director', 'team', 'img/team-majorie-naa-ayorkor-mensah.jpg', 50),
  ('Peace Doe', 'Accounting Manager', 'team', 'img/team-peace-doe.jpg', 60),
  ('Jonathan Karaah', 'Sales Manager North Ghana', 'team', 'img/team-jonathan-karaah.jpg', 70),
  ('Rhoda Kudor', 'Technical Engineer', 'team', 'img/team-rhoda-kudor.jpg', 80),
  ('Kwadwo Asafo-Adjei', 'Technical Engineer', 'team', 'img/team-kwadwo-asafo-adjei.jpg', 90),
  ('Bernard Achaempong', 'Head of Technical Dept., EWIA Infrastructure', 'group', 'img/team-bernard-achaempong.jpg', 10),
  ('Peace Defor', 'Accountant', 'group', 'img/team-peace-defor.jpg', 20),
  ('Uwe Hassenkamp', 'Managing Director Nigeria', 'group', 'img/team-uwe-hassenkamp.jpg', 30),
  ('Egodha Ogedegbe', 'Technical Director, EWIA Green Energy Nigeria Ltd.', 'group', 'img/team-egodha-ogedegbe.jpg', 40),
  ('Ejiro Ogedegbe', 'Project Manager, EWIA Green Energy Nigeria Ltd.', 'group', 'img/team-ejiro-ogedegbe.jpg', 50),
  ('Mike Fohba', 'Managing Director Cameroon', 'group', 'img/team-mike-fohba.jpg', 60),
  ('Bah Kalembar', 'Senior Accounting Manager', 'group', 'img/team-bah-kalembar.jpg', 70),
  ('Victoria Ntam', 'Senior Accounting Manager', 'group', 'img/team-victoria-ntam.jpg', 80);
