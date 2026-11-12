-- 016b: agents / brokers. Commission accrues automatically on every confirmed payment of a client the agent
-- referred, at the agent's per-product rate (or their default rate). Agents see only their own clients' status
-- and totals (no invoice lines, no chat), upload files for them, and follow project progress.

-- ---------------------------------------------------------------- helpers
-- plpgsql (not sql) so the body is only checked when called, after the agents table exists below
create or replace function private.agent_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return private.has_role('agent') and exists (
    select 1 from public.agents a where a.user_id = auth.uid() and a.status = 'active');
end $$;

-- text argument on purpose: used in storage policies where the folder name is not yet known to be a uuid
create or replace function private.agent_has_client(cid text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return private.agent_ok() and exists (
    select 1 from public.clients c where c.id::text = cid and c.agent_id = auth.uid());
end $$;

create or replace function private.new_agent_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; c text; i int;
begin
  loop
    c := 'EA';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.agents where code = c);
  end loop;
  return c;
end $$;

-- ---------------------------------------------------------------- tables
create table public.agents (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  agent_type text not null default 'agent' check (agent_type in ('real_estate_agent', 'broker', 'agent', 'other')),
  agency text check (agency is null or char_length(agency) <= 160),
  default_rate numeric(5,2) not null default 5 check (default_rate between 0 and 100),
  status text not null default 'active' check (status in ('active', 'suspended')),
  payout_details text check (payout_details is null or char_length(payout_details) <= 500),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger agents_updated before update on public.agents for each row execute function private.set_updated_at();

create table public.agent_rates (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(user_id) on delete cascade,
  product text not null check (char_length(btrim(product)) between 1 and 80),
  rate numeric(5,2) not null check (rate between 0 and 100),
  created_at timestamptz not null default now()
);
create unique index agent_rates_uq on public.agent_rates(agent_id, lower(btrim(product)));

alter table public.clients add column agent_id uuid references public.agents(user_id) on delete set null;
create index clients_agent_idx on public.clients(agent_id) where agent_id is not null;
alter table public.client_applications add column agent_code text check (agent_code is null or char_length(agent_code) <= 12);
alter table public.invoices add column product text check (product is null or char_length(product) <= 80);

create table public.agent_leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  interest text check (interest is null or char_length(interest) <= 160),
  status text not null default 'new' check (status in ('new', 'contacted', 'interested', 'converted', 'lost')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_leads_agent_idx on public.agent_leads(agent_id, created_at desc);
create trigger agent_leads_updated before update on public.agent_leads for each row execute function private.set_updated_at();

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(user_id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_id uuid unique references public.payments(id) on delete set null,
  invoice_number text,
  receipt_number text,
  product text,
  base_amount numeric(14,2) not null,
  rate numeric(5,2) not null,
  amount numeric(14,2) not null,
  status text not null default 'accrued' check (status in ('accrued', 'reversed')),
  created_at timestamptz not null default now(),
  reversed_at timestamptz
);
create index commission_entries_agent_idx on public.commission_entries(agent_id, created_at desc);

create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(user_id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('bank_transfer', 'mobile_money', 'cash', 'cheque', 'other')),
  reference text check (reference is null or char_length(reference) <= 120),
  paid_at date not null default current_date,
  note text check (note is null or char_length(note) <= 300),
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index commission_payouts_agent_idx on public.commission_payouts(agent_id, paid_at desc);

create trigger audit_agents after insert or update or delete on public.agents for each row execute function private.audit();
create trigger audit_agent_rates after insert or update or delete on public.agent_rates for each row execute function private.audit();
create trigger audit_commission_payouts after insert or update or delete on public.commission_payouts for each row execute function private.audit();

-- Only administrators decide which agent a client belongs to.
create or replace function private.guard_client_agent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.agent_id is distinct from old.agent_id and not private.is_admin_or_above() then
    raise exception 'Not allowed to change the agent' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger clients_guard_agent before update on public.clients for each row execute function private.guard_client_agent();
-- clients only have column-level UPDATE rights; the guard above lets only administrators actually change it
grant update (agent_id) on public.clients to authenticated;

-- ---------------------------------------------------------------- row level security
alter table public.agents enable row level security;
alter table public.agent_rates enable row level security;
alter table public.agent_leads enable row level security;
alter table public.commission_entries enable row level security;
alter table public.commission_payouts enable row level security;
revoke all on public.agents, public.agent_rates, public.agent_leads, public.commission_entries, public.commission_payouts from anon, authenticated;
grant select on public.agents, public.agent_rates, public.commission_entries, public.commission_payouts to authenticated;
grant insert, update, delete on public.agents, public.agent_rates to authenticated;
grant select, insert, update, delete on public.agent_leads to authenticated;

create policy agents_select on public.agents for select to authenticated
  using (user_id = auth.uid() or private.has_role('super_admin', 'admin', 'accountant'));
create policy agents_write on public.agents for all to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());

create policy rates_select on public.agent_rates for select to authenticated
  using (agent_id = auth.uid() or private.has_role('super_admin', 'admin', 'accountant'));
create policy rates_write on public.agent_rates for all to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());

create policy leads_own on public.agent_leads for all to authenticated
  using (agent_id = auth.uid() and private.agent_ok()) with check (agent_id = auth.uid() and private.agent_ok());
create policy leads_admin_read on public.agent_leads for select to authenticated
  using (private.has_role('super_admin', 'admin'));

create policy commission_select on public.commission_entries for select to authenticated
  using (agent_id = auth.uid() or private.has_role('super_admin', 'admin', 'accountant'));
create policy payouts_select on public.commission_payouts for select to authenticated
  using (agent_id = auth.uid() or private.has_role('super_admin', 'admin', 'accountant'));
-- no insert/update policies on commission tables: they change only through the functions below

-- agents may read their own clients, and (through the helpers) those clients' profile and projects
create policy clients_select_agent on public.clients for select to authenticated
  using (agent_id = auth.uid() and private.agent_ok());

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
    or (private.agent_ok() and exists (
         select 1 from public.clients c where c.profile_id = pid and c.agent_id = auth.uid()))
$$;

create or replace function private.can_view_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects pr where pr.id = p and (
      private.has_role('super_admin','admin','accountant','support_officer')
      or pr.client_id = private.my_client_id()
      or exists (select 1 from public.project_members m
                 where m.project_id = pr.id and m.user_id = auth.uid())
      or (private.agent_ok() and exists (
            select 1 from public.clients c where c.id = pr.client_id and c.agent_id = auth.uid()))
    )
  )
$$;

-- documents: agents upload for their own clients (reviewed by the office) and see only what they uploaded
create policy documents_select_agent on public.documents for select to authenticated
  using (private.agent_ok() and uploaded_by = auth.uid());
create policy documents_insert_agent on public.documents for insert to authenticated
  with check (private.agent_has_client(client_id::text) and direction = 'from_client'
    and (project_id is null or exists (select 1 from public.projects p where p.id = documents.project_id and p.client_id = documents.client_id)));
create policy documents_delete_agent on public.documents for delete to authenticated
  using (private.agent_ok() and uploaded_by = auth.uid() and status = 'pending');

create policy docs_obj_insert_agent on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and private.agent_has_client((storage.foldername(name))[1]));

-- ---------------------------------------------------------------- commission accrual
create or replace function private.accrue_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare aid uuid; inv public.invoices; r numeric; amt numeric; cname text;
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
  amt := round(new.amount * r / 100, 2);
  insert into public.commission_entries(agent_id, client_id, invoice_id, payment_id, invoice_number, receipt_number, product, base_amount, rate, amount)
  values (aid, new.client_id, new.invoice_id, new.id, inv.number, new.receipt_number, inv.product, new.amount, r, amt)
  on conflict (payment_id) do nothing;
  perform private.notify(aid, 'commission_earned', 'Commission earned: GHS ' || amt, cname || ' paid GHS ' || new.amount, '/agent/commission');
  return new;
end $$;
create trigger payments_commission after insert or update of status on public.payments
  for each row execute function private.accrue_commission();

-- ---------------------------------------------------------------- functions for the agent dashboard
create or replace function public.agent_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); earned numeric; paid numeric; month_earned numeric;
begin
  if not private.agent_ok() then raise exception 'Forbidden' using errcode = '42501'; end if;
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where created_at >= date_trunc('month', now())), 0)
    into earned, month_earned from public.commission_entries where agent_id = me and status = 'accrued';
  select coalesce(sum(amount), 0) into paid from public.commission_payouts where agent_id = me;
  return jsonb_build_object(
    'clients', (select count(*) from public.clients where agent_id = me),
    'active_clients', (select count(*) from public.clients c join public.profiles p on p.id = c.profile_id where c.agent_id = me and p.status = 'active'),
    'active_projects', (select count(*) from public.projects pr join public.clients c on c.id = pr.client_id
                        where c.agent_id = me and not pr.archived and pr.status::text not in ('completed', 'cancelled')),
    'leads_open', (select count(*) from public.agent_leads where agent_id = me and status in ('new', 'contacted', 'interested')),
    'earned', earned, 'paid', paid, 'pending', greatest(earned - paid, 0), 'month_earned', month_earned);
end $$;

create or replace function public.agent_client_overview()
returns table(client_id uuid, name text, company text, phone text, account_status text, joined timestamptz,
              projects int, active_projects int, invoiced numeric, paid numeric, outstanding numeric, commission numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.agent_ok() then raise exception 'Forbidden' using errcode = '42501'; end if;
  return query
  select c.id, p.full_name, c.company_name, p.phone, p.status::text, c.created_at,
    (select count(*)::int from public.projects pr where pr.client_id = c.id and not pr.archived),
    (select count(*)::int from public.projects pr where pr.client_id = c.id and not pr.archived and pr.status::text not in ('completed', 'cancelled')),
    coalesce((select sum(i.total) from public.invoices i where i.client_id = c.id and i.status in ('issued', 'partially_paid', 'overdue', 'paid')), 0),
    coalesce((select sum(i.amount_paid) from public.invoices i where i.client_id = c.id and i.status in ('issued', 'partially_paid', 'overdue', 'paid')), 0),
    coalesce((select sum(i.total - i.amount_paid) from public.invoices i where i.client_id = c.id and i.status in ('issued', 'partially_paid', 'overdue')), 0),
    coalesce((select sum(e.amount) from public.commission_entries e where e.client_id = c.id and e.agent_id = auth.uid() and e.status = 'accrued'), 0)
  from public.clients c join public.profiles p on p.id = c.profile_id
  where c.agent_id = auth.uid()
  order by c.created_at desc;
end $$;

create or replace function public.update_my_agent_details(p_agency text, p_payout_details text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.agent_ok() then raise exception 'Forbidden' using errcode = '42501'; end if;
  update public.agents set
    agency = nullif(left(btrim(regexp_replace(coalesce(p_agency, ''), '[[:cntrl:]<>]', '', 'g')), 160), ''),
    payout_details = nullif(left(btrim(regexp_replace(coalesce(p_payout_details, ''), '[[:cntrl:]<>]', '', 'g')), 500), '')
  where user_id = auth.uid();
end $$;

create or replace function public.record_commission_payout(p_agent uuid, p_amount numeric, p_method text,
  p_reference text default null, p_paid_at date default current_date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare earned numeric; paid numeric; pid uuid;
begin
  if not private.has_role('super_admin', 'admin', 'accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.agents where user_id = p_agent) then raise exception 'Agent not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  -- serialise payouts per agent so two clicks cannot overspend the balance
  perform 1 from public.agents where user_id = p_agent for update;
  select coalesce(sum(amount), 0) into earned from public.commission_entries where agent_id = p_agent and status = 'accrued';
  select coalesce(sum(amount), 0) into paid from public.commission_payouts where agent_id = p_agent;
  if p_amount > earned - paid then raise exception 'Payout exceeds the balance owed (GHS %)', earned - paid; end if;
  insert into public.commission_payouts(agent_id, amount, method, reference, paid_at, note, recorded_by)
  values (p_agent, p_amount, p_method, left(p_reference, 120), p_paid_at, left(p_note, 300), auth.uid()) returning id into pid;
  perform private.notify(p_agent, 'commission_paid', 'Commission paid: GHS ' || p_amount, null, '/agent/commission');
  return pid;
end $$;

revoke all on function public.agent_overview(), public.agent_client_overview(), public.update_my_agent_details(text, text),
  public.record_commission_payout(uuid, numeric, text, text, date, text) from public, anon;
grant execute on function public.agent_overview(), public.agent_client_overview(), public.update_my_agent_details(text, text),
  public.record_commission_payout(uuid, numeric, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------- sign-up: agent accounts and referral codes
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.app_role := 'client'; ac text; aid uuid;
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

  if r = 'agent' then
    insert into public.agents(user_id, code) values (new.id, private.new_agent_code());
  end if;

  if r = 'client' then
    -- an optional referral code (?ref=) links the client to the agent who brought them
    ac := upper(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'agent_code', ''), '[^A-Za-z0-9]', '', 'g'), 12));
    if ac <> '' then
      select user_id into aid from public.agents where code = ac and status = 'active';
    end if;
    insert into public.clients(profile_id, company_name, agent_id)
    values (new.id, left(new.raw_user_meta_data ->> 'company', 160), aid);
    insert into public.client_applications(user_id, company, address, notes, agent_code)
    values (new.id, left(new.raw_user_meta_data ->> 'company', 160),
            left(new.raw_user_meta_data ->> 'address', 300),
            left(new.raw_user_meta_data ->> 'notes', 1000), nullif(ac, ''));
    perform private.notify(new.id, 'registration_received', 'Registration received',
      'Thank you for registering. Please verify your email address. An administrator will then review and approve your account.', null);
    perform private.notify(aid, 'agent_referral', 'New client signed up with your link',
      coalesce(nullif(left(new.raw_user_meta_data ->> 'full_name', 120), ''), 'A new client') || ' is waiting for approval.', '/agent/clients');
  end if;
  return new;
end $$;

create or replace function public.review_client_application(p_user uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare aid uuid; nm text;
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
  select c.agent_id, coalesce(nullif(p.full_name, ''), 'Your client') into aid, nm
    from public.clients c join public.profiles p on p.id = c.profile_id where c.profile_id = p_user;
  perform private.notify(aid, 'agent_client_' || p_decision, nm || (case when p_decision = 'approved' then ' is now approved' else ' was not approved' end), null, '/agent/clients');
end $$;
