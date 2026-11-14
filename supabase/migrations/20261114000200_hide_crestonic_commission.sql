-- The Crestonic commission is visible to the Super Administrator only.
-- Admins and accountants can still read online payments, but not the commission columns, and the audit trail
-- no longer carries them. Run this AFTER the portal build that selects explicit columns is deployed.

-- 1. Column-level privileges: authenticated users can read every column except the commission ones.
revoke select on public.online_payments from authenticated;
grant select (id, reference, invoice_id, client_id, amount, fees, channel, paystack_id, status, settled_as,
              payment_id, deposit_id, initiated_by, created_at, paid_at, note)
  on public.online_payments to authenticated;

-- 2. The commission is returned only to a Super Administrator.
create or replace function public.online_payment_commissions()
returns table(id uuid, commission_percent numeric, commission numeric)
language sql stable security definer set search_path = '' as $$
  select o.id, o.commission_percent, o.commission
  from public.online_payments o
  where private.has_role('super_admin')
$$;
revoke all on function public.online_payment_commissions() from public, anon;
grant execute on function public.online_payment_commissions() to authenticated;

-- 3. The audit trail for online payments stores the row without the commission columns.
create or replace function private.audit_online() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'commission' - 'commission_percent' end;
        j_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'commission' - 'commission_percent' end;
begin
  insert into public.audit_logs(actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce(j_new ->> 'id', j_old ->> 'id'), j_old, j_new);
  return coalesce(new, old);
end $$;

drop trigger if exists audit_online_payments on public.online_payments;
create trigger audit_online_payments after insert or update on public.online_payments
  for each row execute function private.audit_online();

update public.audit_logs
   set old_data = old_data - 'commission' - 'commission_percent',
       new_data = new_data - 'commission' - 'commission_percent'
 where table_name = 'online_payments';

-- 4. Changes to the payment-settings row (which holds the commission percentage) are visible to the Super Administrator only.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  (private.is_admin_or_above() and (table_name <> 'paystack_config' or private.has_role('super_admin')))
  or (private.has_role('accountant') and table_name = any (array['invoices','payments','ledger_entries','deposits']))
);
