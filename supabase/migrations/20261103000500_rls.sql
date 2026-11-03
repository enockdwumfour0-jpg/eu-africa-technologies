-- 005: Row Level Security for every table. Default deny; each policy is explicit.

alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.clients               enable row level security;
alter table public.client_applications   enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.projects              enable row level security;
alter table public.project_members       enable row level security;
alter table public.project_requests      enable row level security;
alter table public.project_request_notes enable row level security;
alter table public.project_milestones    enable row level security;
alter table public.project_updates       enable row level security;
alter table public.documents             enable row level security;
alter table public.document_reviews      enable row level security;
alter table public.message_threads       enable row level security;
alter table public.messages              enable row level security;
alter table public.notifications         enable row level security;
alter table public.support_tickets       enable row level security;
alter table public.invoices              enable row level security;
alter table public.payments              enable row level security;
alter table public.ledger_accounts       enable row level security;
alter table public.ledger_entries        enable row level security;

-- Tighten table privileges: anon gets nothing on portal data.
revoke all on public.profiles, public.user_roles, public.clients, public.client_applications,
  public.audit_logs, public.projects, public.project_members, public.project_requests,
  public.project_request_notes, public.project_milestones, public.project_updates,
  public.documents, public.document_reviews, public.message_threads, public.messages,
  public.notifications, public.support_tickets, public.invoices, public.payments,
  public.ledger_accounts, public.ledger_entries from anon;

-- Roles are never writable from the client API; accounts only via RPC/trigger.
revoke insert, update, delete on public.user_roles, public.client_applications, public.audit_logs,
  public.payments, public.ledger_entries, public.ledger_accounts, public.notifications,
  public.clients from authenticated;
grant update (company_name, address) on public.clients to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (status) on public.message_threads to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, phone, company, avatar_path, notification_prefs, status,
              approved_by, approved_at, rejection_reason) on public.profiles to authenticated;
-- (status/approval columns are further blocked for non-admins by private.guard_profile)

-- ---- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_view_profile(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or private.is_admin_or_above())
  with check (id = auth.uid() or private.is_admin_or_above());

-- ---- user_roles (read only)
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.is_staff());

-- ---- clients
create policy clients_select on public.clients for select to authenticated using (
  profile_id = auth.uid()
  or private.has_role('super_admin','admin','support_officer','accountant')
  or (private.has_role('project_manager') and exists (
        select 1 from public.projects pr join public.project_members m on m.project_id = pr.id
        where pr.client_id = clients.id and m.user_id = auth.uid())));
create policy clients_update on public.clients for update to authenticated
  using (profile_id = auth.uid() or private.is_admin_or_above())
  with check (profile_id = auth.uid() or private.is_admin_or_above());

-- ---- client_applications
create policy apps_select on public.client_applications for select to authenticated
  using (user_id = auth.uid() or private.has_role('super_admin','admin','support_officer'));

-- ---- audit_logs
create policy audit_select on public.audit_logs for select to authenticated using (
  private.is_admin_or_above()
  or (private.has_role('accountant') and table_name in ('invoices','payments','ledger_entries')));

-- ---- projects
create policy projects_select on public.projects for select to authenticated
  using (private.can_view_project(id) and (not archived or private.is_staff()));
create policy projects_insert on public.projects for insert to authenticated
  with check (private.is_admin_or_above());
create policy projects_update on public.projects for update to authenticated
  using (private.can_manage_project(id)) with check (private.can_manage_project(id));

create or replace function private.projects_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_admin_or_above()
     and (new.client_id is distinct from old.client_id or new.archived is distinct from old.archived
          or new.code is distinct from old.code) then
    raise exception 'Only administrators can reassign or archive projects' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger projects_guard before update on public.projects
  for each row execute function private.projects_guard();

-- ---- project_members
create policy members_select on public.project_members for select to authenticated
  using (private.can_view_project(project_id));
create policy members_write on public.project_members for all to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());

-- ---- project_requests
create policy requests_select on public.project_requests for select to authenticated using (
  client_id = private.my_client_id()
  or private.has_role('super_admin','admin','support_officer')
  or assigned_to = auth.uid());
create policy requests_insert on public.project_requests for insert to authenticated
  with check (client_id = private.my_client_id() and status = 'submitted'
              and assigned_to is null and converted_project_id is null);
create policy requests_update on public.project_requests for update to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());

create policy req_notes_select on public.project_request_notes for select to authenticated
  using (private.has_role('super_admin','admin','support_officer'));
create policy req_notes_insert on public.project_request_notes for insert to authenticated
  with check (private.has_role('super_admin','admin','support_officer') and author_id = auth.uid());

-- ---- milestones & updates
create policy milestones_select on public.project_milestones for select to authenticated
  using (private.can_view_project(project_id));
create policy milestones_write on public.project_milestones for all to authenticated
  using (private.can_manage_project(project_id)) with check (private.can_manage_project(project_id));

create policy updates_select on public.project_updates for select to authenticated
  using (private.can_view_project(project_id) and (visible_to_client or private.is_staff()));
create policy updates_insert on public.project_updates for insert to authenticated
  with check (private.can_manage_project(project_id) and author_id = auth.uid());
create policy updates_modify on public.project_updates for update to authenticated
  using (author_id = auth.uid() or private.is_admin_or_above())
  with check (author_id = auth.uid() or private.is_admin_or_above());
create policy updates_delete on public.project_updates for delete to authenticated
  using (author_id = auth.uid() or private.is_admin_or_above());

-- ---- documents
create policy documents_select on public.documents for select to authenticated using (
  private.has_role('super_admin','admin','support_officer')
  or (project_id is not null and private.has_role('project_manager') and private.can_view_project(project_id))
  or (client_id = private.my_client_id() and (direction = 'from_client' or status = 'approved')));
create policy documents_insert_client on public.documents for insert to authenticated with check (
  direction = 'from_client' and client_id = private.my_client_id()
  and (project_id is null or exists (select 1 from public.projects p
         where p.id = project_id and p.client_id = private.my_client_id())));
create policy documents_insert_staff on public.documents for insert to authenticated with check (
  private.is_admin_or_above()
  or (project_id is not null and private.can_manage_project(project_id)));
create policy documents_update on public.documents for update to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());
create policy documents_delete on public.documents for delete to authenticated using (
  private.is_admin_or_above()
  or (client_id = private.my_client_id() and direction = 'from_client' and status = 'pending'));

create policy reviews_select on public.document_reviews for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));
create policy reviews_insert on public.document_reviews for insert to authenticated
  with check (private.can_review_doc(document_id));

-- ---- messaging
create policy threads_select on public.message_threads for select to authenticated
  using (private.can_access_thread(id));
create policy threads_insert_client on public.message_threads for insert to authenticated with check (
  client_id = private.my_client_id() and created_by = auth.uid()
  and (project_id is null or exists (select 1 from public.projects p
         where p.id = project_id and p.client_id = private.my_client_id())));
create policy threads_insert_staff on public.message_threads for insert to authenticated with check (
  created_by = auth.uid() and private.has_role('super_admin','admin','support_officer'));
create policy threads_update on public.message_threads for update to authenticated
  using (private.is_staff() and private.can_access_thread(id))
  with check (private.is_staff() and private.can_access_thread(id));

create policy messages_select on public.messages for select to authenticated
  using (private.can_access_thread(thread_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (private.can_access_thread(thread_id) and sender_id = auth.uid()
              and exists (select 1 from public.message_threads t where t.id = thread_id and t.status = 'open'));

-- ---- notifications (own only)
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- support tickets
create policy tickets_select on public.support_tickets for select to authenticated using (
  client_id = private.my_client_id()
  or private.has_role('super_admin','admin','support_officer')
  or assigned_to = auth.uid());
create policy tickets_insert on public.support_tickets for insert to authenticated
  with check (client_id = private.my_client_id() and status = 'open' and assigned_to is null);
create policy tickets_update on public.support_tickets for update to authenticated
  using (private.has_role('super_admin','admin','support_officer'))
  with check (private.has_role('super_admin','admin','support_officer'));

-- ---- finance
create policy invoices_select on public.invoices for select to authenticated using (
  private.has_role('super_admin','admin','accountant')
  or (client_id = private.my_client_id() and status <> 'draft'));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (private.has_role('super_admin','admin','accountant'));
create policy invoices_update on public.invoices for update to authenticated
  using (private.has_role('super_admin','admin','accountant'))
  with check (private.has_role('super_admin','admin','accountant'));
create policy invoices_delete on public.invoices for delete to authenticated
  using (private.has_role('super_admin','admin','accountant') and status = 'draft');

create policy payments_select on public.payments for select to authenticated using (
  private.has_role('super_admin','admin','accountant') or client_id = private.my_client_id());
create policy ledger_accounts_select on public.ledger_accounts for select to authenticated
  using (private.has_role('super_admin','admin','accountant'));
create policy ledger_entries_select on public.ledger_entries for select to authenticated using (
  private.has_role('super_admin','admin','accountant') or client_id = private.my_client_id());
