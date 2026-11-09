-- 004: invoices, payments, double-entry ledger (no stored-value wallet, no transfers)

create sequence public.invoice_seq start 1;
create sequence public.receipt_seq start 1;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0')),
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','issued','partially_paid','paid','overdue','void')),
  issue_date date,
  due_date date,
  currency text not null default 'GHS' check (currency = 'GHS'),
  line_items jsonb not null default '[]'::jsonb,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total = subtotal + tax),
  check (amount_paid <= total)
);
create index invoices_client_idx on public.invoices(client_id);
create index invoices_status_idx on public.invoices(status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default ('RCT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0')),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('bank_transfer','cash','mobile_money','cheque','other')),
  reference text check (reference is null or char_length(reference) <= 120),
  paid_at date not null default current_date,
  status text not null default 'confirmed' check (status in ('confirmed','reversed')),
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments(invoice_id);
create index payments_client_idx on public.payments(client_id);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset','liability','revenue','expense','equity')),
  created_at timestamptz not null default now()
);
insert into public.ledger_accounts(code, name, type) values
  ('1000','Cash and Bank','asset'),
  ('1100','Accounts Receivable','asset'),
  ('4000','Service Revenue','revenue');

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_group uuid not null,
  account_id uuid not null references public.ledger_accounts(id),
  client_id uuid references public.clients(id),
  invoice_id uuid references public.invoices(id),
  payment_id uuid references public.payments(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  description text not null check (char_length(description) <= 300),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((debit = 0) <> (credit = 0))
);
create index ledger_entries_client_idx on public.ledger_entries(client_id, created_at);
create index ledger_entries_group_idx on public.ledger_entries(entry_group);

-- The ledger is append-only for everyone, including privileged roles.
create or replace function private.ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Ledger entries are immutable; post a reversing entry instead'; end $$;
create trigger ledger_no_update before update or delete on public.ledger_entries
  for each row execute function private.ledger_immutable();

create trigger invoices_updated before update on public.invoices
  for each row execute function private.set_updated_at();

-- Direct edits by end users are limited to draft invoices; everything else goes through RPCs.
create or replace function private.invoice_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' or new.amount_paid <> 0 then
        raise exception 'New invoices must be drafts' using errcode = '42501';
      end if;
      new.created_by := auth.uid();
    elsif tg_op = 'UPDATE' then
      if old.status <> 'draft' or new.status <> 'draft' or new.amount_paid <> old.amount_paid then
        raise exception 'Issued invoices are locked; use the finance functions' using errcode = '42501';
      end if;
    elsif tg_op = 'DELETE' and old.status <> 'draft' then
      raise exception 'Only draft invoices can be deleted' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger invoices_guard before insert or update or delete on public.invoices
  for each row execute function private.invoice_guard();

create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function private.audit();
create trigger audit_payments after insert or update on public.payments
  for each row execute function private.audit();
create trigger audit_ledger after insert on public.ledger_entries
  for each row execute function private.audit();

-- ----------------------------------------------------------------- RPCs
create or replace function private.acct(c text) returns uuid
language sql stable set search_path = '' as $$ select id from public.ledger_accounts where code = c $$;

create or replace function public.issue_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; g uuid := gen_random_uuid(); cp uuid;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status <> 'draft' then raise exception 'Only draft invoices can be issued'; end if;
  if inv.total <= 0 then raise exception 'Invoice total must be greater than zero'; end if;
  update public.invoices set status = 'issued', issue_date = coalesce(issue_date, current_date),
    due_date = coalesce(due_date, current_date + 14) where id = p_invoice;
  insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, debit, credit, description, created_by) values
    (g, private.acct('1100'), inv.client_id, inv.id, inv.total, 0, 'Invoice ' || inv.number || ' issued', auth.uid()),
    (g, private.acct('4000'), inv.client_id, inv.id, 0, inv.total, 'Invoice ' || inv.number || ' issued', auth.uid());
  select profile_id into cp from public.clients where id = inv.client_id;
  perform private.notify(cp, 'invoice_issued', 'New invoice ' || inv.number, 'Total GHS ' || inv.total, '/portal/payments');
end $$;

create or replace function public.record_payment(
  p_invoice uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_at date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; pid uuid; g uuid := gen_random_uuid(); newpaid numeric; cp uuid;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status not in ('issued','partially_paid','overdue') then raise exception 'Invoice is not open for payment'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_amount > inv.total - inv.amount_paid then raise exception 'Payment exceeds outstanding balance'; end if;
  insert into public.payments(invoice_id, client_id, amount, method, reference, paid_at, recorded_by)
  values (inv.id, inv.client_id, p_amount, p_method, left(p_reference, 120), p_paid_at, auth.uid())
  returning id into pid;
  newpaid := inv.amount_paid + p_amount;
  update public.invoices set amount_paid = newpaid,
    status = case when newpaid >= total then 'paid' else 'partially_paid' end where id = inv.id;
  insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, payment_id, debit, credit, description, created_by) values
    (g, private.acct('1000'), inv.client_id, inv.id, pid, p_amount, 0, 'Payment received for ' || inv.number, auth.uid()),
    (g, private.acct('1100'), inv.client_id, inv.id, pid, 0, p_amount, 'Payment received for ' || inv.number, auth.uid());
  select profile_id into cp from public.clients where id = inv.client_id;
  perform private.notify(cp, 'payment_received', 'Payment received: GHS ' || p_amount, 'Invoice ' || inv.number, '/portal/payments');
  return pid;
end $$;

create or replace function public.reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; inv public.invoices; g uuid := gen_random_uuid(); newpaid numeric;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then raise exception 'A reason is required'; end if;
  select * into pay from public.payments where id = p_payment for update;
  if not found or pay.status <> 'confirmed' then raise exception 'Payment cannot be reversed'; end if;
  select * into inv from public.invoices where id = pay.invoice_id for update;
  update public.payments set status = 'reversed', reversal_reason = left(p_reason, 300) where id = pay.id;
  newpaid := inv.amount_paid - pay.amount;
  update public.invoices set amount_paid = newpaid,
    status = case when newpaid = 0 then 'issued' else 'partially_paid' end where id = inv.id;
  insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, payment_id, debit, credit, description, created_by) values
    (g, private.acct('1100'), pay.client_id, inv.id, pay.id, pay.amount, 0, 'Reversal of ' || pay.receipt_number, auth.uid()),
    (g, private.acct('1000'), pay.client_id, inv.id, pay.id, 0, pay.amount, 'Reversal of ' || pay.receipt_number, auth.uid());
end $$;

create or replace function public.void_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; g uuid := gen_random_uuid();
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice for update;
  if not found or inv.status in ('void','paid','partially_paid') or inv.amount_paid > 0 then
    raise exception 'Invoice cannot be voided (reverse payments first)';
  end if;
  if inv.status <> 'draft' then
    insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, debit, credit, description, created_by) values
      (g, private.acct('4000'), inv.client_id, inv.id, inv.total, 0, 'Invoice ' || inv.number || ' voided', auth.uid()),
      (g, private.acct('1100'), inv.client_id, inv.id, 0, inv.total, 'Invoice ' || inv.number || ' voided', auth.uid());
  end if;
  update public.invoices set status = 'void' where id = inv.id;
end $$;

-- Marks past-due invoices (call from a scheduled job or on dashboard load).
create or replace function public.mark_overdue_invoices() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  update public.invoices set status = 'overdue'
  where status in ('issued','partially_paid') and due_date < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.issue_invoice, public.record_payment, public.reverse_payment,
  public.void_invoice, public.mark_overdue_invoices from public, anon;
grant execute on function public.issue_invoice, public.record_payment, public.reverse_payment,
  public.void_invoice, public.mark_overdue_invoices to authenticated;
