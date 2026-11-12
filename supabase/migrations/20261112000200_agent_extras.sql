-- 018: agent extras: chat with the office, a resources library, and commission tiers / monthly targets.

-- ---------------------------------------------------------------- chat with the office
-- A thread belongs either to a client or to an agent.
alter table public.message_threads alter column client_id drop not null;
alter table public.message_threads add column agent_id uuid references public.profiles(id) on delete cascade;
alter table public.message_threads add constraint message_threads_owner_chk check ((client_id is not null) <> (agent_id is not null));
create index message_threads_agent_idx on public.message_threads(agent_id) where agent_id is not null;

create or replace function private.can_access_thread(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.message_threads th where th.id = t and (
      th.client_id = private.my_client_id()
      or private.has_role('super_admin','admin','support_officer')
      or (th.project_id is not null and private.has_role('project_manager')
          and private.can_view_project(th.project_id))
      or (th.agent_id = auth.uid() and private.agent_ok())
    )
  )
$$;

drop policy if exists threads_select on public.message_threads;
create policy threads_select on public.message_threads for select to authenticated using (
  client_id = private.my_client_id()
  or private.has_role('super_admin', 'admin', 'support_officer')
  or (project_id is not null and private.has_role('project_manager') and private.can_view_project(project_id))
  or (agent_id = auth.uid() and private.agent_ok()));
create policy threads_insert_agent on public.message_threads for insert to authenticated
  with check (private.agent_ok() and agent_id = auth.uid() and client_id is null and project_id is null and created_by = auth.uid());

create or replace function private.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare th public.message_threads; cp uuid;
begin
  update public.message_threads set last_message_at = new.created_at where id = new.thread_id returning * into th;
  if th.agent_id is not null then
    if new.from_staff then
      perform private.notify(th.agent_id, 'message', 'New message from the EU-AFRIC office', left(new.body, 200), '/agent/messages');
    else
      perform private.notify_roles(array['admin','super_admin','support_officer']::public.app_role[], 'message',
        'New agent message: ' || th.subject, left(new.body, 200), '/admin/messages');
    end if;
    return null;
  end if;
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

-- ---------------------------------------------------------------- resources library (brochures, price lists, ...)
create table public.agent_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 500),
  category text check (category is null or char_length(category) <= 60),
  storage_path text not null check (char_length(storage_path) <= 400),
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  published boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.agent_resources enable row level security;
revoke all on public.agent_resources from anon, authenticated;
grant select, insert, update, delete on public.agent_resources to authenticated;
create policy resources_select on public.agent_resources for select to authenticated
  using (private.is_admin_or_above() or (published and private.agent_ok()));
create policy resources_write on public.agent_resources for all to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());
create trigger audit_agent_resources after insert or update or delete on public.agent_resources for each row execute function private.audit();

create or replace function private.resource_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.published then
    perform private.notify_roles(array['agent']::public.app_role[], 'agent_resource', 'New resource: ' || new.title, null, '/agent/resources');
  end if;
  return null;
end $$;
create trigger resources_ai after insert on public.agent_resources for each row execute function private.resource_after_insert();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('agent-resources', 'agent-resources', false, 20971520, array['application/pdf',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy agentres_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'agent-resources' and exists (select 1 from public.agent_resources r where r.storage_path = objects.name));
create policy agentres_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'agent-resources' and private.is_admin_or_above());
create policy agentres_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'agent-resources' and private.is_admin_or_above());

-- ---------------------------------------------------------------- tiers and targets
-- A tier adds bonus percentage points to an agent's rate once their collections in the calendar month reach a threshold.
create table public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  min_monthly numeric(14,2) not null unique check (min_monthly > 0),
  bonus_rate numeric(5,2) not null check (bonus_rate > 0 and bonus_rate <= 50),
  created_at timestamptz not null default now()
);
alter table public.commission_tiers enable row level security;
revoke all on public.commission_tiers from anon, authenticated;
grant select, insert, update, delete on public.commission_tiers to authenticated;
create policy tiers_select on public.commission_tiers for select to authenticated
  using (private.has_role('super_admin', 'admin', 'accountant') or private.agent_ok());
create policy tiers_write on public.commission_tiers for all to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());
create trigger audit_commission_tiers after insert or update or delete on public.commission_tiers for each row execute function private.audit();

alter table public.agents add column monthly_target numeric(14,2) check (monthly_target is null or monthly_target >= 0);
alter table public.commission_entries add column bonus_rate numeric(5,2) not null default 0;

create or replace function private.accrue_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare aid uuid; inv public.invoices; r numeric; bonus numeric; mtd numeric; amt numeric; cname text;
begin
  if new.status = 'reversed' and tg_op = 'UPDATE' and old.status is distinct from 'reversed' then
    update public.commission_entries set status = 'reversed', reversed_at = now()
      where payment_id = new.id and status = 'accrued';
    return new;
  end if;
  if new.status <> 'confirmed' or (tg_op = 'UPDATE' and old.status = 'confirmed') then return new; end if;

  select c.agent_id, coalesce(nullif(p.full_name, ''), c.company_name, 'Client') into aid, cname
    from public.clients c join public.profiles p on p.id = c.profile_id where c.id = new.client_id;
  if aid is null then return new; end if;
  select * into inv from public.invoices where id = new.invoice_id;
  select coalesce(
      (select ar.rate from public.agent_rates ar where ar.agent_id = aid and lower(btrim(ar.product)) = lower(btrim(coalesce(inv.product, '')))),
      (select a.default_rate from public.agents a where a.user_id = aid)) into r;
  if r is null or r <= 0 then return new; end if;
  -- tier bonus: collections this calendar month (including this payment) decide the extra percentage points
  select coalesce(sum(base_amount), 0) + new.amount into mtd from public.commission_entries
    where agent_id = aid and status = 'accrued' and created_at >= date_trunc('month', now());
  select coalesce(max(bonus_rate), 0) into bonus from public.commission_tiers where min_monthly <= mtd;
  r := least(100, r + bonus);
  amt := round(new.amount * r / 100, 2);
  insert into public.commission_entries(agent_id, client_id, invoice_id, payment_id, invoice_number, receipt_number, product, base_amount, rate, bonus_rate, amount)
  values (aid, new.client_id, new.invoice_id, new.id, inv.number, new.receipt_number, inv.product, new.amount, r, bonus, amt)
  on conflict (payment_id) do nothing;
  perform private.notify(aid, 'commission_earned', 'Commission earned: GHS ' || amt, cname || ' paid GHS ' || new.amount, '/agent/commission');
  return new;
end $$;

create or replace function public.agent_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); earned numeric; paid numeric; month_earned numeric; mtd numeric; nxt numeric;
begin
  if not private.agent_ok() then raise exception 'Forbidden' using errcode = '42501'; end if;
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where created_at >= date_trunc('month', now())), 0),
         coalesce(sum(base_amount) filter (where created_at >= date_trunc('month', now())), 0)
    into earned, month_earned, mtd from public.commission_entries where agent_id = me and status = 'accrued';
  select coalesce(sum(amount), 0) into paid from public.commission_payouts where agent_id = me;
  select min(min_monthly) into nxt from public.commission_tiers where min_monthly > mtd;
  return jsonb_build_object(
    'clients', (select count(*) from public.clients where agent_id = me),
    'active_clients', (select count(*) from public.clients c join public.profiles p on p.id = c.profile_id where c.agent_id = me and p.status = 'active'),
    'active_projects', (select count(*) from public.projects pr join public.clients c on c.id = pr.client_id
                        where c.agent_id = me and not pr.archived and pr.status::text not in ('completed', 'cancelled')),
    'leads_open', (select count(*) from public.agent_leads where agent_id = me and status in ('new', 'contacted', 'interested')),
    'earned', earned, 'paid', paid, 'pending', greatest(earned - paid, 0), 'month_earned', month_earned,
    'month_collected', mtd,
    'target', (select monthly_target from public.agents where user_id = me),
    'bonus_now', (select coalesce(max(bonus_rate), 0) from public.commission_tiers where min_monthly <= mtd),
    'next_min', nxt,
    'next_bonus', (select bonus_rate from public.commission_tiers where min_monthly = nxt));
end $$;
