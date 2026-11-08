-- 013: Paystack online payments (card / mobile money) with an optional commission split.
-- Disabled until a Super Administrator turns it on AND the PAYSTACK_SECRET_KEY secret is set on the edge functions.
-- The secret key never touches the database or the browser. Money is only recorded after the edge function has
-- verified the transaction with Paystack and calls settle_online_payment (service role only).

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('bank_transfer','cash','mobile_money','cheque','other','account_credit','paystack'));
create unique index payments_paystack_ref_uq on public.payments(reference) where method = 'paystack';

-- ------------------------------------------------------------------ configuration (Super Administrator only)
create table public.paystack_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  subaccount_code text check (subaccount_code is null or subaccount_code ~ '^ACCT_[A-Za-z0-9]{6,40}$'),
  commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 30),
  fee_bearer text not null default 'subaccount' check (fee_bearer in ('account','subaccount')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (not enabled or commission_percent = 0 or subaccount_code is not null)
);
insert into public.paystack_config default values;
alter table public.paystack_config enable row level security;
revoke all on public.paystack_config from anon, authenticated;
grant select, update on public.paystack_config to authenticated;
create policy paystack_cfg_select on public.paystack_config for select to authenticated using (private.has_role('super_admin'));
create policy paystack_cfg_update on public.paystack_config for update to authenticated
  using (private.has_role('super_admin')) with check (private.has_role('super_admin'));
create or replace function private.paystack_cfg_stamp() returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger paystack_cfg_stamp before update on public.paystack_config for each row execute function private.paystack_cfg_stamp();
create trigger audit_paystack_cfg after update on public.paystack_config for each row execute function private.audit();

-- ------------------------------------------------------------------ online payment attempts
create table public.online_payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  commission_percent numeric(5,2) not null default 0,
  commission numeric(14,2) not null default 0,
  fees numeric(14,2),
  channel text,
  paystack_id text,
  status text not null default 'initiated' check (status in ('initiated','success','failed')),
  settled_as text check (settled_as in ('payment','credit')),
  payment_id uuid references public.payments(id),
  deposit_id uuid references public.deposits(id),
  initiated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index online_payments_client_idx on public.online_payments(client_id);
alter table public.online_payments enable row level security;
revoke all on public.online_payments from anon, authenticated;
grant select on public.online_payments to authenticated;
create policy online_payments_select on public.online_payments for select to authenticated using (
  private.has_role('super_admin','admin','accountant') or client_id = private.my_client_id());
create trigger audit_online_payments after insert or update on public.online_payments for each row execute function private.audit();
create policy audit_select_online on public.audit_logs for select to authenticated using (
  private.has_role('accountant') and table_name = 'online_payments');

-- the portal asks only whether online payment is on (never sees commission or account codes)
create or replace function public.online_payments_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.paystack_config), false) and auth.uid() is not null
$$;
revoke all on function public.online_payments_enabled() from public, anon;
grant execute on function public.online_payments_enabled() to authenticated;

-- ------------------------------------------------------------------ settlement (service role only)
-- Called by the edge function after it has verified the transaction with Paystack. Idempotent.
-- If the invoice can no longer take the money (already paid, voided, or the amount changed), the money is kept
-- as the client's account credit instead of being lost.
create or replace function public.settle_online_payment(
  p_reference text, p_paystack_id text, p_amount_pesewas bigint, p_currency text, p_channel text, p_fees_pesewas bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare op public.online_payments; inv public.invoices; amt numeric(14,2); pid uuid; did uuid; rn text;
        g uuid := gen_random_uuid(); cp uuid; newpaid numeric;
begin
  select * into op from public.online_payments where reference = p_reference for update;
  if not found then raise exception 'Unknown reference'; end if;
  if op.status = 'success' then return 'already'; end if;
  if p_currency is distinct from 'GHS' or p_amount_pesewas is distinct from round(op.amount * 100)::bigint then
    raise exception 'Amount or currency mismatch';
  end if;
  amt := op.amount;
  select * into inv from public.invoices where id = op.invoice_id for update;
  select profile_id into cp from public.clients where id = op.client_id;
  if inv.status in ('issued','partially_paid','overdue') and amt <= inv.total - inv.amount_paid then
    insert into public.payments(invoice_id, client_id, amount, method, reference, paid_at)
      values (inv.id, inv.client_id, amt, 'paystack', op.reference, current_date) returning id, receipt_number into pid, rn;
    newpaid := inv.amount_paid + amt;
    update public.invoices set amount_paid = newpaid, status = case when newpaid >= total then 'paid' else 'partially_paid' end where id = inv.id;
    insert into public.ledger_entries(entry_group, account_id, client_id, invoice_id, payment_id, debit, credit, description) values
      (g, private.acct('1000'), inv.client_id, inv.id, pid, amt, 0, 'Online payment (Paystack) for ' || inv.number),
      (g, private.acct('1100'), inv.client_id, inv.id, pid, 0, amt, 'Online payment (Paystack) for ' || inv.number);
    perform private.notify(cp, 'payment_received', 'Payment received: GHS ' || amt, 'Invoice ' || inv.number || '. Receipt ' || rn, '/portal/payments');
    update public.online_payments set status = 'success', settled_as = 'payment', payment_id = pid, paystack_id = p_paystack_id,
      channel = left(p_channel, 40), fees = p_fees_pesewas / 100.0, paid_at = now() where id = op.id;
    return 'payment';
  end if;
  insert into public.deposits(client_id, amount, method, reference, paid_at)
    values (op.client_id, amt, 'other', left('Paystack ' || op.reference, 120), current_date) returning id, receipt_number into did, rn;
  insert into public.ledger_entries(entry_group, account_id, client_id, deposit_id, debit, credit, description) values
    (g, private.acct('1000'), op.client_id, did, amt, 0, 'Deposit received ' || rn),
    (g, private.acct('2100'), op.client_id, did, 0, amt, 'Deposit received ' || rn);
  perform private.notify(cp, 'payment_received', 'Payment received: GHS ' || amt, 'The invoice was already settled, so this was added to your account credit. Receipt ' || rn, '/portal/payments');
  update public.online_payments set status = 'success', settled_as = 'credit', deposit_id = did, paystack_id = p_paystack_id,
    channel = left(p_channel, 40), fees = p_fees_pesewas / 100.0, paid_at = now() where id = op.id;
  return 'credit';
end $$;
revoke all on function public.settle_online_payment(text, text, bigint, text, text, bigint) from public, anon, authenticated;
grant execute on function public.settle_online_payment(text, text, bigint, text, text, bigint) to service_role;
