-- 003: documents, reviews, messaging, notifications, support tickets

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  category text check (category is null or char_length(category) <= 60),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  direction text not null check (direction in ('to_client','from_client')),
  storage_path text not null unique check (char_length(storage_path) <= 400),
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_client_idx on public.documents(client_id);
create index documents_project_idx on public.documents(project_id);
create index documents_status_idx on public.documents(status);

create table public.document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected','comment')),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
create index document_reviews_doc_idx on public.document_reviews(document_id, created_at);

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 160),
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid not null references auth.users(id),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index message_threads_client_idx on public.message_threads(client_id, last_message_at desc);
create index message_threads_project_idx on public.message_threads(project_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  from_staff boolean not null default false,
  body text check (body is null or char_length(body) <= 4000),
  attachment_path text check (attachment_path is null or char_length(attachment_path) <= 400),
  attachment_name text check (attachment_name is null or char_length(attachment_name) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null)
);
create index messages_thread_idx on public.messages(thread_id, created_at);
create index messages_unread_idx on public.messages(thread_id) where read_at is null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (char_length(type) <= 60),
  title text not null check (char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 1000),
  link text check (link is null or char_length(link) <= 300),
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 160),
  body text not null check (char_length(body) between 1 and 4000),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  assigned_to uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_client_idx on public.support_tickets(client_id);
create index support_tickets_status_idx on public.support_tickets(status);

create trigger documents_updated before update on public.documents
  for each row execute function private.set_updated_at();
create trigger support_tickets_updated before update on public.support_tickets
  for each row execute function private.set_updated_at();

-- ------------------------------------------------------------- helpers
create or replace function private.can_access_thread(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.message_threads th where th.id = t and (
      th.client_id = private.my_client_id()
      or private.has_role('super_admin','admin','support_officer')
      or (th.project_id is not null and private.has_role('project_manager')
          and private.can_view_project(th.project_id))
    )
  )
$$;

create or replace function private.can_review_doc(d uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents x where x.id = d and (
      private.has_role('super_admin','admin')
      or (x.project_id is not null and private.can_manage_project(x.project_id))
    )
  )
$$;

-- Who may see another user's profile: self, office staff, a PM for their clients,
-- or a client for staff assigned to their projects.
create or replace function private.can_view_profile(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select pid = auth.uid()
    or private.has_role('super_admin','admin','support_officer','accountant')
    or (private.has_role('project_manager') and (
         exists (select 1 from public.user_roles r where r.user_id = pid and r.role <> 'client')
         or exists (select 1 from public.clients c
                    join public.projects pr on pr.client_id = c.id
                    join public.project_members m on m.project_id = pr.id
                    where c.profile_id = pid and m.user_id = auth.uid())))
    or (private.has_role('client') and exists (
         select 1 from public.project_members m
         join public.projects pr on pr.id = m.project_id
         where m.user_id = pid and pr.client_id = private.my_client_id()))
$$;
grant execute on all functions in schema private to authenticated;

-- ------------------------------------------------------- notifications
create or replace function private.notify(uid uuid, ntype text, ntitle text, nbody text, nlink text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if uid is null then return; end if;
  insert into public.notifications(user_id, type, title, body, link)
  values (uid, ntype, left(ntitle, 200), left(nbody, 1000), nlink);
end $$;

create or replace function private.notify_roles(roles public.app_role[], ntype text, ntitle text, nbody text, nlink text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, type, title, body, link)
  select r.user_id, ntype, left(ntitle, 200), left(nbody, 1000), nlink
  from public.user_roles r join public.profiles p on p.id = r.user_id
  where r.role = any (roles) and p.status = 'active';
end $$;

-- ------------------------------------------------------------ triggers
-- documents: server decides status/uploader; clients can never self-approve
create or replace function private.documents_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.status := case when new.direction = 'to_client' then 'approved' else 'pending' end;
  return new;
end $$;
create trigger documents_bi before insert on public.documents
  for each row execute function private.documents_before_insert();

create or replace function private.documents_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cp uuid;
begin
  select profile_id into cp from public.clients where id = new.client_id;
  if new.direction = 'to_client' then
    perform private.notify(cp, 'document_shared', 'New document: ' || new.title, null, '/portal/documents');
  else
    perform private.notify_roles(array['admin','super_admin']::public.app_role[], 'document_uploaded',
      'Client uploaded: ' || new.title, null, '/admin/documents');
  end if;
  return null;
end $$;
create trigger documents_ai after insert on public.documents
  for each row execute function private.documents_after_insert();

create or replace function private.reviews_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin new.reviewer_id := auth.uid(); return new; end $$;
create trigger reviews_bi before insert on public.document_reviews
  for each row execute function private.reviews_before_insert();

create or replace function private.reviews_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.documents; cp uuid;
begin
  select * into d from public.documents where id = new.document_id;
  if new.decision in ('approved','rejected') then
    update public.documents set status = new.decision where id = d.id;
  end if;
  select profile_id into cp from public.clients where id = d.client_id;
  perform private.notify(cp, 'document_' || new.decision,
    case new.decision when 'approved' then 'Document approved: ' when 'rejected' then 'Document rejected: ' else 'Comment on: ' end || d.title,
    new.comment, '/portal/documents');
  return null;
end $$;
create trigger reviews_ai after insert on public.document_reviews
  for each row execute function private.reviews_after_insert();

-- messages: sender and side are set by the server, never by the caller
create or replace function private.messages_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.sender_id := auth.uid();
  new.from_staff := private.is_staff();
  new.read_at := null;
  return new;
end $$;
create trigger messages_bi before insert on public.messages
  for each row execute function private.messages_before_insert();

create or replace function private.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare th public.message_threads; cp uuid;
begin
  update public.message_threads set last_message_at = new.created_at where id = new.thread_id
  returning * into th;
  if new.from_staff then
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
create trigger messages_ai after insert on public.messages
  for each row execute function private.messages_after_insert();

create or replace function public.mark_thread_read(p_thread uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_access_thread(p_thread) then raise exception 'Forbidden' using errcode = '42501'; end if;
  update public.messages set read_at = now()
  where thread_id = p_thread and read_at is null and from_staff = not private.is_staff();
end $$;
revoke all on function public.mark_thread_read from public, anon;
grant execute on function public.mark_thread_read to authenticated;

-- account / project events
create or replace function private.profile_status_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and old.status = 'pending' then
    perform private.notify(new.id, 'account_approved', 'Your account has been approved', 'You can now use the client portal.', '/portal');
  elsif new.status = 'rejected' then
    perform private.notify(new.id, 'account_rejected', 'Your registration was not approved', new.rejection_reason, null);
  end if;
  return null;
end $$;
create trigger profiles_status_notify after update on public.profiles
  for each row when (old.status is distinct from new.status) execute function private.profile_status_notify();

create or replace function private.application_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_roles(array['admin','super_admin']::public.app_role[], 'client_registered',
    'New client registration awaiting approval', null, '/admin/clients');
  return null;
end $$;
create trigger client_apps_notify after insert on public.client_applications
  for each row execute function private.application_notify();

create or replace function private.member_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pr public.projects; cp uuid;
begin
  select * into pr from public.projects where id = new.project_id;
  perform private.notify(new.user_id, 'project_assigned', 'You were assigned to ' || pr.title, null, '/admin/projects');
  select profile_id into cp from public.clients where id = pr.client_id;
  perform private.notify(cp, 'project_assigned', 'A project manager was assigned to ' || pr.title, null, '/portal/projects');
  return null;
end $$;
create trigger members_notify after insert on public.project_members
  for each row execute function private.member_notify();

create or replace function private.update_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pr public.projects; cp uuid;
begin
  if not new.visible_to_client then return null; end if;
  select * into pr from public.projects where id = new.project_id;
  select profile_id into cp from public.clients where id = pr.client_id;
  perform private.notify(cp, 'project_update', pr.title || ': ' || new.title, left(new.body, 200), '/portal/projects');
  return null;
end $$;
create trigger project_updates_notify after insert on public.project_updates
  for each row execute function private.update_notify();

create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function private.audit();
create trigger audit_document_reviews after insert on public.document_reviews
  for each row execute function private.audit();
