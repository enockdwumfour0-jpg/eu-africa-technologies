-- 014: hardening found in the payment/security review
-- 1. Clients must not see Crestonic's commission: online_payments is readable by finance staff only.
-- 2. Least privilege: drop table rights nobody needs (TRUNCATE bypasses row level security).
-- 3. settle_online_payment never loses money: a differing amount is kept as account credit and flagged;
--    a wrong currency is flagged for staff. Admins are notified either way.

drop policy online_payments_select on public.online_payments;
create policy online_payments_select on public.online_payments for select to authenticated using (
  private.has_role('super_admin','admin','accountant'));
alter table public.online_payments add column note text;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on public.admins from anon;
revoke all on public.enquiries from anon;       grant insert on public.enquiries to anon;
revoke all on public.gallery_items from anon;   grant select on public.gallery_items to anon;
revoke all on public.land_listings from anon;   grant select on public.land_listings to anon;

create or replace function public.settle_online_payment(
  p_reference text, p_paystack_id text, p_amount_pesewas bigint, p_currency text, p_channel text, p_fees_pesewas bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare op public.online_payments; inv public.invoices; amt numeric(14,2); pid uuid; did uuid; rn text;
        g uuid := gen_random_uuid(); cp uuid; newpaid numeric; why text;
begin
  select * into op from public.online_payments where reference = p_reference for update;
  if not found then raise exception 'Unknown reference'; end if;
  if op.status = 'success' then return 'already'; end if;
  if p_amount_pesewas is null or p_amount_pesewas <= 0 then raise exception 'Invalid amount'; end if;
  if p_currency is distinct from 'GHS' then
    update public.online_payments set note = 'Paid in ' || left(coalesce(p_currency, '?'), 8) || ', not GHS. Not recorded; check in Paystack.', paystack_id = p_paystack_id where id = op.id;
    perform private.notify_roles(array['super_admin','admin','accountant']::public.app_role[], 'payment_received',
      'Online payment needs attention', 'Reference ' || op.reference || ' was paid in a different currency and was not recorded.', '/admin/finance');
    return 'flagged';
  end if;
  amt := round(p_amount_pesewas / 100.0, 2);
  select * into inv from public.invoices where id = op.invoice_id for update;
  select profile_id into cp from public.clients where id = op.client_id;
  if amt = op.amount and inv.status in ('issued','partially_paid','overdue') and amt <= inv.total - inv.amount_paid then
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
  why := case when amt <> op.amount then 'Amount paid differed from the invoice amount; kept as account credit.'
              else 'Invoice was already settled; kept as account credit.' end;
  insert into public.deposits(client_id, amount, method, reference, paid_at)
    values (op.client_id, amt, 'other', left('Paystack ' || op.reference, 120), current_date) returning id, receipt_number into did, rn;
  insert into public.ledger_entries(entry_group, account_id, client_id, deposit_id, debit, credit, description) values
    (g, private.acct('1000'), op.client_id, did, amt, 0, 'Deposit received ' || rn),
    (g, private.acct('2100'), op.client_id, did, 0, amt, 'Deposit received ' || rn);
  perform private.notify(cp, 'payment_received', 'Payment received: GHS ' || amt, 'This was added to your account credit. Receipt ' || rn, '/portal/payments');
  update public.online_payments set status = 'success', settled_as = 'credit', deposit_id = did, paystack_id = p_paystack_id, note = why,
    channel = left(p_channel, 40), fees = p_fees_pesewas / 100.0, paid_at = now() where id = op.id;
  if amt <> op.amount then
    perform private.notify_roles(array['super_admin','admin','accountant']::public.app_role[], 'payment_received',
      'Online payment needs attention', 'Reference ' || op.reference || ': ' || why, '/admin/finance');
  end if;
  return 'credit';
end $$;
revoke all on function public.settle_online_payment(text, text, bigint, text, text, bigint) from public, anon, authenticated;
grant execute on function public.settle_online_payment(text, text, bigint, text, text, bigint) to service_role;
