-- 021: agents can message (a) the staff members an administrator has chosen and (b) their own clients.
--
-- Kinds of conversation after this migration (all in message_threads):
--   client <-> team   client_id only                    (unchanged)
--   agent  <-> office agent_id only                     (unchanged; seen by admins and support officers)
--   agent  <-> staff  agent_id + staff_id               (private to those two people; the Super Administrator can also read it)
--   agent  <-> client agent_id + client_id              (the client, their agent, admins and support officers)

-- ---------------------------------------------------------------- staff an agent may message
create table public.staff_agent_contacts (
  staff_id uuid primary key references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.staff_agent_contacts enable row level security;
revoke all on public.staff_agent_contacts from anon, authenticated;
grant select on public.staff_agent_contacts to authenticated;
create policy contacts_select on public.staff_agent_contacts for select to authenticated using (private.is_staff());

create or replace function public.set_agent_contact(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.app_role;
begin
  if not private.is_admin_or_above() then raise exception 'Forbidden' using errcode = '42501'; end if;
  select role into target from public.user_roles where user_id = p_user;
  if target is null or target in ('client', 'agent') then raise exception 'That is not a staff account'; end if;
  if not private.can_manage_staff_role(target) then
    raise exception 'Only a super administrator can change administrator accounts' using errcode = '42501';
  end if;
  if p_on then
    insert into public.staff_agent_contacts(staff_id, added_by) values (p_user, auth.uid()) on conflict do nothing;
  else
    delete from public.staff_agent_contacts where staff_id = p_user;
  end if;
end $$;

-- what an agent sees when choosing who to message: name and position only
create or replace function public.agent_message_contacts() returns table(id uuid, full_name text, job_title text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.agent_ok() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name, p.job_title
    from public.staff_agent_contacts c
    join public.profiles p on p.id = c.staff_id
    join public.user_roles r on r.user_id = p.id
    where p.status = 'active' and r.role not in ('client', 'agent')
    order by p.full_name;
end $$;

create or replace function private.is_agent_contact(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_agent_contacts c join public.profiles p on p.id = c.staff_id
    where c.staff_id = sid and p.status = 'active')
$$;

create or replace function private.agent_owns_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clients c where c.id = cid and c.agent_id = auth.uid())
$$;

revoke all on function public.set_agent_contact(uuid, boolean), public.agent_message_contacts() from public, anon;
grant execute on function public.set_agent_contact(uuid, boolean), public.agent_message_contacts() to authenticated;

-- ---------------------------------------------------------------- threads
alter table public.message_threads add column staff_id uuid references public.profiles(id) on delete cascade;
alter table public.message_threads drop constraint message_threads_owner_chk;
alter table public.message_threads add constraint message_threads_owner_chk check (
     (client_id is not null and agent_id is null     and staff_id is null)       -- client <-> team
  or (client_id is null     and agent_id is not null and staff_id is null)       -- agent <-> office
  or (client_id is null     and agent_id is not null and staff_id is not null)   -- agent <-> staff
  or (client_id is not null and agent_id is not null and staff_id is null));     -- agent <-> client
create unique index message_threads_agent_staff_open on public.message_threads(agent_id, staff_id)
  where staff_id is not null and status = 'open';
create unique index message_threads_agent_client_open on public.message_threads(agent_id, client_id)
  where agent_id is not null and client_id is not null and status = 'open';

create or replace function private.can_access_thread(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.message_threads th where th.id = t and (
      th.client_id = private.my_client_id()
      or private.has_role('super_admin')
      or (th.staff_id is null and private.has_role('admin', 'support_officer'))
      or (th.project_id is not null and private.has_role('project_manager') and private.can_view_project(th.project_id))
      -- an agent keeps a chat with a client only while that client is still theirs
      or (th.agent_id = auth.uid() and private.agent_ok()
          and (th.client_id is null or private.agent_owns_client(th.client_id)))
      or (th.staff_id = auth.uid() and private.is_staff())
    )
  )
$$;

drop policy if exists threads_select on public.message_threads;
create policy threads_select on public.message_threads for select to authenticated using (private.can_access_thread(id));

drop policy if exists threads_insert_agent on public.message_threads;
create policy threads_insert_agent on public.message_threads for insert to authenticated with check (
  private.agent_ok() and agent_id = auth.uid() and created_by = auth.uid() and project_id is null and (
       (client_id is null and staff_id is null)                                              -- the office
    or (client_id is null and staff_id is not null and private.is_agent_contact(staff_id))   -- a chosen staff member
    or (staff_id is null and client_id is not null and private.agent_owns_client(client_id)) -- their own client
  ));

-- clients and staff can no longer attach an agent or a staff member to a thread they create
drop policy if exists threads_insert_client on public.message_threads;
create policy threads_insert_client on public.message_threads for insert to authenticated with check (
  client_id = private.my_client_id() and created_by = auth.uid() and agent_id is null and staff_id is null
  and (project_id is null or exists (select 1 from public.projects p where p.id = message_threads.project_id and p.client_id = private.my_client_id())));

drop policy if exists threads_insert_staff on public.message_threads;
create policy threads_insert_staff on public.message_threads for insert to authenticated with check (
  created_by = auth.uid() and private.has_role('super_admin', 'admin', 'support_officer')
  and staff_id is null and not (agent_id is not null and client_id is not null));

-- ---------------------------------------------------------------- read receipts
create or replace function public.mark_thread_read(p_thread uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare th public.message_threads; me uuid := auth.uid(); cp uuid;
begin
  if not private.can_access_thread(p_thread) then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into th from public.message_threads where id = p_thread;
  if th.staff_id is not null then
    -- agent <-> staff: only the two people in the chat mark each other's messages read
    if me = th.agent_id then
      update public.messages set read_at = now() where thread_id = p_thread and read_at is null and sender_id = th.staff_id;
    elsif me = th.staff_id then
      update public.messages set read_at = now() where thread_id = p_thread and read_at is null and sender_id = th.agent_id;
    end if;
  elsif th.agent_id is not null and th.client_id is not null then
    select profile_id into cp from public.clients where id = th.client_id;
    if me = th.agent_id then
      update public.messages set read_at = now() where thread_id = p_thread and read_at is null and sender_id = cp;
    elsif me = cp then
      update public.messages set read_at = now() where thread_id = p_thread and read_at is null and sender_id = th.agent_id;
    end if;
  else
    update public.messages set read_at = now()
    where thread_id = p_thread and read_at is null and from_staff = not private.is_staff();
  end if;
end $$;

-- ---------------------------------------------------------------- notifications
create or replace function private.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare th public.message_threads; cp uuid;
begin
  update public.message_threads set last_message_at = new.created_at where id = new.thread_id returning * into th;

  if th.staff_id is not null then                       -- agent <-> chosen staff member
    if new.sender_id = th.agent_id then
      perform private.notify(th.staff_id, 'message', 'New message from an agent', left(new.body, 200), '/admin/messages');
    else
      perform private.notify(th.agent_id, 'message', 'New message from the EU-AFRIC office', left(new.body, 200), '/agent/messages');
    end if;
    return null;
  end if;

  if th.agent_id is not null and th.client_id is not null then   -- agent <-> own client
    select profile_id into cp from public.clients where id = th.client_id;
    if new.sender_id = th.agent_id then
      perform private.notify(cp, 'message', 'New message from your agent', left(new.body, 200), '/portal/messages');
    else
      perform private.notify(th.agent_id, 'message', 'New message from your client', left(new.body, 200), '/agent/messages');
    end if;
    return null;
  end if;

  if th.agent_id is not null then                       -- agent <-> office
    if new.from_staff then
      perform private.notify(th.agent_id, 'message', 'New message from the EU-AFRIC office', left(new.body, 200), '/agent/messages');
    else
      perform private.notify_roles(array['admin','super_admin','support_officer']::public.app_role[], 'message',
        'New agent message: ' || th.subject, left(new.body, 200), '/admin/messages');
    end if;
    return null;
  end if;

  if new.from_staff then                                -- client <-> team
    select profile_id into cp from public.clients where id = th.client_id;
    perform private.notify(cp, 'message', 'New message: ' || th.subject, left(new.body, 200), '/portal/messages');
  else
    perform private.notify_roles(array['admin','super_admin','support_officer']::public.app_role[], 'message',
      'New client message: ' || th.subject, left(new.body, 200), '/admin/messages');
    if th.project_id is not null then
      insert into public.notifications(user_id, type, title, body, link)
      select m.user_id, 'message', 'New client message: ' || th.subject, left(new.body, 200), '/admin/messages'
      from public.project_members m where m.project_id = th.project_id;
    end if;
  end if;
  return null;
end $$;
