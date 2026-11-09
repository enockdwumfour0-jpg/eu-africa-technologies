-- 010: account credit. A client can pay in advance; the accountant records the deposit and it is held
-- as a credit balance (liability 2100) that can only be applied to that client's invoices.
-- No withdrawals, no transfers between clients, no provider integration.

insert into public.ledger_accounts(code, name, type) values ('2100', 'Client Account Credit', 'liability');

-- ------------------------------------------------- ledger: account code and deposit link
-- Clients may read their own ledger rows but not the chart of accounts, so each row carries its
-- account code. The code is set by a trigger; rows stay immutable afterwards.
alter table public.ledger_entries add column account_code text;
alter table public.ledger_entries disable trigger ledger_no_update;
update public.ledger_entries e set account_code = a.code
  from public.ledger_accounts a where a.id = e.account_id;
alter table public.ledger_entries enable trigger ledger_no_update;
alter table public.ledger_entries alter column account_code set not null;

create or replace function private.ledger_set_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.account_code := (select code from public.ledger_accounts where id = new.account_id);
  return new;
end $$;
create trigger ledger_code_bi before insert on public.ledger_entries
  for each row execute function private.ledger_set_code();
create index ledger_entries_code_idx on public.ledger_entries(client_id, account_code);

-- ----------------------------------------------------------------------- deposits
create sequence public.deposit_seq start 1;
create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique
    default ('DEP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.deposit_seq')::text, 5, '0')),
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  method text not null check (method in ('bank_transfer','cash','mobile_money','cheque','other')),
  reference text check (reference is null or char_length(reference) <= 120),
  paid_at date not null default current_date,
  status text not null default 'confirmed' check (status in ('confirmed','reversed')),
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index deposits_client_idx on public.deposits(client_id);

alter table public.ledger_entries add column deposit_id uuid references public.deposits(id);

alter table public.deposits enable row level security;
revoke all on public.deposits from anon;
revoke insert, update, delete on public.deposits from authenticated;
create policy deposits_select on public.deposits for select to authenticated using (
  private.has_role('super_admin','admin','accountant') or client_id = private.my_client_id());
create trigger audit_deposits after insert or update on public.deposits
  for each row execute function private.audit();

-- accountants may read the audit trail of every financial table, deposits included
drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  private.is_admin_or_above()
  or (private.has_role('accountant') and table_name in ('invoices','payments','ledger_entries','deposits')));

-- credit-applied payments appear in the payments table with their own method
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('bank_transfer','cash','mobile_money','cheque','other','account_credit'));

-- ---------------------------------------------------------------------- functions
create or replace function private.credit_balance(c uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(credit - debit), 0)::numeric(14,2)
  from public.ledger_entries where client_id = c and account_code = '2100'
$$;

-- A client reads their own balance; finance staff may read any client's.
create or replace function public.client_credit_balance(p_client uuid default null) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare c uuid := coalesce(p_client, private.my_client_id());
begin
  if c is null then return 0; end if;
  -- coalesce: for staff without a client row my_client_id() is NULL, and "NOT NULL" would not raise
  if not coalesce(private.has_role('super_admin','admin','accountant') or c = private.my_client_id(), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return private.credit_balance(c);
end $$;

create or replace function public.record_deposit(
  p_client uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_at date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare did uuid; rn text; g uuid := gen_random_uuid(); cp uuid;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Amount must be positive'; end if;
  if p_method is null or p_method not in ('bank_transfer','cash','mobile_money','cheque','other') then
    raise exception 'Invalid payment method';
  end if;
  if p_paid_at is null or p_paid_at > current_date then raise exception 'Date cannot be in the future'; end if;
  select c.profile_id into cp from public.clients c join public.profiles p on p.id = c.profile_id
    where c.id = p_client and p.status = 'active' for update of c;
  if not found then raise exception 'Client not found or not active'; end if;
  insert into public.deposits(client_id, amount, method, reference, paid_at, recorded_by)
  values (p_client, p_amount, p_method, left(p_reference, 120), p_paid_at, auth.uid())
  returning id, receipt_number into did, rn;
  insert into public.ledger_entries(entry_group, account_id, client_id, deposit_id, debit, credit, description, created_by) values
    (g, private.acct('1000'), p_client, did, p_amount, 0, 'Deposit received ' || rn, auth.uid()),
    (g, private.acct('2100'), p_client, did, 0, p_amount, 'Deposit received ' || rn, auth.uid());
  perform private.notify(cp, 'payment_received', 'Deposit received: GHS ' || p_amount,
    'Added to your account credit. Receipt ' || rn, '/portal/payments');
  return did;
end $$;

create or replace function public.reverse_deposit(p_deposit uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare dep public.deposits; g uuid := gen_random_uuid();
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then raise exception 'A reason is required'; end if;
  select * into dep from public.deposits where id = p_deposit for update;
  if not found or dep.status <> 'confirmed' then raise exception 'Deposit cannot be reversed'; end if;
  perform 1 from public.clients where id = dep.client_id for update;
  if private.credit_balance(dep.client_id) < dep.amount then
    raise exception 'Credit has already been applied to invoices; reverse those payments first';
  end if;
  update public.deposits set status = 'reversed', reversal_reason = left(p_reason, 300) where id = dep.id;
  insert into public.ledger_entries(entry_group, account_id, client_id, deposit_id, debit, credit, description, created_by) values
    (g, private.acct('2100'), dep.client_id, dep.id, dep.amount, 0, 'Reversal of ' || dep.receipt_number, auth.uid()),
    (g, private.acct('1000'), dep.client_id, dep.id, 0, dep.amount, 'Reversal of ' || dep.receipt_number, auth.uid());
end $$;

create or replace function public.apply_credit(p_invoice uuid, p_amount numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; pid uuid; g uuid := gen_random_uuid(); bal numeric; newpaid numeric; cp uuid;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status not in ('issued','partially_paid','overdue') then raise exception 'Invoice is not open for payment'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_amount > inv.total - inv.amount_paid then raise exception 'Amount exceeds outstanding balance'; end if;
  select c.profile_id into cp from public.clients c where c.id = inv.client_id for update;
  bal := private.credit_balance(inv.client_id);
  if p_amount > bal then raise exception 'Insufficient account credit (available GHS %)', bal; end if;
  insert into public.payments(invoice_id, client_id, amount, method, reference, paid_at, recorded_by)
  values (inv.id, inv.client_id, p_amount, 'account_credit', 'Applied from account credit', current_date, auth.uid())
  returning id into pid;
  newpaid := inv.amount_paid + p_amount;
  update public.invoices set amount_paid = newpaid,
    status = case when newpaid >= total then 'paid' else 'partially_paid' end where id = inv.id;
  insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, payment_id, debit, credit, description, created_by) values
    (g, private.acct('2100'), inv.client_id, inv.id, pid, p_amount, 0, 'Account credit applied to ' || inv.number, auth.uid()),
    (g, private.acct('1100'), inv.client_id, inv.id, pid, 0, p_amount, 'Account credit applied to ' || inv.number, auth.uid());
  perform private.notify(cp, 'payment_received', 'Account credit applied: GHS ' || p_amount, 'Invoice ' || inv.number, '/portal/payments');
  return pid;
end $$;

-- record_payment: real money methods only (credit is applied through apply_credit)
create or replace function public.record_payment(
  p_invoice uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_at date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; pid uuid; g uuid := gen_random_uuid(); newpaid numeric; cp uuid;
begin
  if not private.has_role('super_admin','admin','accountant') then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_method is null or p_method not in ('bank_transfer','cash','mobile_money','cheque','other') then
    raise exception 'Invalid payment method';
  end if;
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

-- reverse_payment: a reversed credit-applied payment returns the money to the client's credit,
-- not to cash.
create or replace function public.reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare pay public.payments; inv public.invoices; g uuid := gen_random_uuid(); newpaid numeric; back uuid;
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
  back := case when pay.method = 'account_credit' then private.acct('2100') else private.acct('1000') end;
  insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, payment_id, debit, credit, description, created_by) values
    (g, private.acct('1100'), pay.client_id, inv.id, pay.id, pay.amount, 0, 'Reversal of ' || pay.receipt_number, auth.uid()),
    (g, back,                  pay.client_id, inv.id, pay.id, 0, pay.amount, 'Reversal of ' || pay.receipt_number, auth.uid());
end $$;

revoke all on function public.client_credit_balance, public.record_deposit, public.reverse_deposit,
  public.apply_credit from public, anon;
grant execute on function public.client_credit_balance, public.record_deposit, public.reverse_deposit,
  public.apply_credit to authenticated;
