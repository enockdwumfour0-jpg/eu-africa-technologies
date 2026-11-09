-- 002: projects, members, requests, milestones, progress updates

create type public.project_status as enum ('planning','active','on_hold','completed','cancelled');
create sequence public.project_code_seq start 1;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('EAP-' || lpad(nextval('public.project_code_seq')::text, 5, '0')),
  title text not null check (char_length(title) between 1 and 160),
  description text check (description is null or char_length(description) <= 4000),
  client_id uuid not null references public.clients(id) on delete restrict,
  status public.project_status not null default 'planning',
  progress int not null default 0 check (progress between 0 and 100),
  location text check (location is null or char_length(location) <= 200),
  start_date date,
  estimated_completion date,
  completed_at timestamptz,
  archived boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_client_idx on public.projects(client_id);
create index projects_status_idx on public.projects(status) where not archived;

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'manager' check (member_role in ('manager','staff')),
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members(user_id);

create table public.project_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null check (char_length(description) between 1 and 4000),
  service_type text check (service_type is null or char_length(service_type) <= 80),
  location text check (location is null or char_length(location) <= 200),
  budget_range text check (budget_range is null or char_length(budget_range) <= 80),
  preferred_start date,
  status text not null default 'submitted'
    check (status in ('submitted','under_review','approved','rejected','converted')),
  assigned_to uuid references auth.users(id),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  converted_project_id uuid references public.projects(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_requests_client_idx on public.project_requests(client_id);
create index project_requests_status_idx on public.project_requests(status);

-- Internal notes live in their own table so clients can never read them.
create table public.project_request_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.project_requests(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index project_request_notes_req_idx on public.project_request_notes(request_id);

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position int not null check (position > 0),
  title text not null check (char_length(title) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  status text not null default 'upcoming' check (status in ('upcoming','current','completed')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position) deferrable initially deferred
);
create index project_milestones_project_idx on public.project_milestones(project_id);

create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  title text not null check (char_length(title) between 1 and 160),
  body text check (body is null or char_length(body) <= 4000),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 12),
  visible_to_client boolean not null default true,
  created_at timestamptz not null default now()
);
create index project_updates_project_idx on public.project_updates(project_id, created_at desc);

create trigger projects_updated before update on public.projects
  for each row execute function private.set_updated_at();
create trigger project_requests_updated before update on public.project_requests
  for each row execute function private.set_updated_at();
create trigger project_milestones_updated before update on public.project_milestones
  for each row execute function private.set_updated_at();

-- Standard 10-stage milestone set for every new project.
create or replace function private.seed_milestones() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t text[] := array['Project Request Submitted','Initial Consultation','Project Assessment',
  'Proposal Submitted','Contract Approved','Initial Payment Confirmed','Project Commenced',
  'Work in Progress','Final Inspection','Project Completed'];
begin
  for i in 1..10 loop
    insert into public.project_milestones(project_id, position, title, status)
    values (new.id, i, t[i], case when i = 1 then 'current' else 'upcoming' end);
  end loop;
  return new;
end $$;
create trigger projects_seed_milestones after insert on public.projects
  for each row execute function private.seed_milestones();

create or replace function private.milestone_completed_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger milestones_completed_at before insert or update on public.project_milestones
  for each row execute function private.milestone_completed_at();

-- Progress % is derived from milestones, never typed in by hand.
create or replace function private.recalc_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pid uuid := coalesce(new.project_id, old.project_id); done int; total int;
begin
  select count(*) filter (where status = 'completed'), count(*) into done, total
  from public.project_milestones where project_id = pid;
  update public.projects set
    progress = case when total = 0 then 0 else round(100.0 * done / total)::int end,
    status = case when total > 0 and done = total then 'completed'::public.project_status
                  when status = 'planning' and done > 0 then 'active'::public.project_status
                  else status end,
    completed_at = case when total > 0 and done = total then coalesce(completed_at, now()) else null end
  where id = pid;
  return null;
end $$;
create trigger milestones_progress after insert or update or delete on public.project_milestones
  for each row execute function private.recalc_progress();

create trigger audit_projects after insert or update or delete on public.projects
  for each row execute function private.audit();

-- Project visibility helpers (used by RLS and storage policies)
create or replace function private.can_view_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects pr where pr.id = p and (
      private.has_role('super_admin','admin','accountant','support_officer')
      or pr.client_id = private.my_client_id()
      or exists (select 1 from public.project_members m
                 where m.project_id = pr.id and m.user_id = auth.uid())
    )
  )
$$;

create or replace function private.can_manage_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin_or_above() or (
    private.has_role('project_manager') and exists (
      select 1 from public.project_members m where m.project_id = p and m.user_id = auth.uid())
  )
$$;
grant execute on all functions in schema private to authenticated;

-- Convert an approved request into a project (admin, or the assigned project manager)
create or replace function public.convert_request_to_project(p_request uuid, p_manager uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.project_requests; pid uuid;
begin
  if not private.has_role('super_admin','admin') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into r from public.project_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('approved') then raise exception 'Only approved requests can be converted'; end if;
  insert into public.projects(title, description, client_id, location, created_by)
  values (r.title, r.description, r.client_id, r.location, auth.uid()) returning id into pid;
  if p_manager is not null then
    insert into public.project_members(project_id, user_id, member_role, assigned_by)
    values (pid, p_manager, 'manager', auth.uid());
  end if;
  update public.project_requests set status = 'converted', converted_project_id = pid where id = p_request;
  return pid;
end $$;
revoke all on function public.convert_request_to_project from public, anon;
grant execute on function public.convert_request_to_project to authenticated;
