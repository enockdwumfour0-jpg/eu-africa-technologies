-- Account credit tests. Runs after 10_rls_tests.sql and reuses its users and data:
-- client A has an issued invoice of 1000 with 400 already paid; client B has no invoices.

-- client A was suspended at the end of the previous file; reactivate
select t.act('adm');
select t.allowed('admin reactivates A', $q$ select public.set_account_status((select id from t.u where name='a'), 'active') $q$);
select t.back();

-- client ids as plain fixtures, so lookups do not depend on who is signed in
create table t.c (name text primary key, id uuid not null);
insert into t.c select split_part(p.email, '@', 1), c.id from public.clients c join public.profiles p on p.id = c.profile_id;
grant select on t.c to public;
create function t.cid(n text) returns uuid language sql stable as $$ select id from t.c where name = n $$;
grant execute on function t.cid(text) to public;

-- ------------------------------------------------------------------ deposits
select t.act('acc');
select t.denied('zero deposit rejected', $q$ select public.record_deposit(t.cid('a'), 0, 'cash') $q$);
select t.denied('negative deposit rejected', $q$ select public.record_deposit(t.cid('a'), -5, 'cash') $q$);
select t.denied('absurd deposit rejected', $q$ select public.record_deposit(t.cid('a'), 10000000000, 'cash') $q$);
select t.denied('unknown method rejected', $q$ select public.record_deposit(t.cid('a'), 10, 'bitcoin') $q$);
select t.denied('account_credit is not a deposit method', $q$ select public.record_deposit(t.cid('a'), 10, 'account_credit') $q$);
select t.denied('future-dated deposit rejected', $q$ select public.record_deposit(t.cid('a'), 10, 'cash', null, current_date + 1) $q$);
select t.denied('deposit for unknown client rejected', $q$ select public.record_deposit(gen_random_uuid(), 10, 'cash') $q$);
select t.allowed('accountant records a deposit for A', $q$ select public.record_deposit(t.cid('a'), 500, 'bank_transfer', 'D1') $q$);
select t.eq('credit balance is 500', (select (public.client_credit_balance(t.cid('a')) * 100)::bigint), 50000);
select t.back();

-- ------------------------------------------------------------ who can see what
select t.act('a');
select t.eq('client A reads own credit balance', (select (public.client_credit_balance() * 100)::bigint), 50000);
select t.eq('client A sees own deposit', t.n('select * from public.deposits'), 1);
select t.eq('client A sees own credit ledger rows', t.n($q$select * from public.ledger_entries where account_code = '2100'$q$), 1);
select t.eq('client A still cannot read the chart of accounts', t.n('select * from public.ledger_accounts'), 0);
select t.eq('client statement rows carry an account code', t.n($q$select * from public.ledger_entries where account_code = '1100'$q$), 2);
select t.denied('client cannot record a deposit', $q$ select public.record_deposit(t.cid('a'), 10, 'cash') $q$);
select t.denied('client cannot insert deposits directly', $q$ insert into public.deposits(client_id, amount, method) values (t.cid('a'), 10, 'cash') $q$);
select t.denied('client cannot edit deposits', $q$ update public.deposits set amount = 1 $q$);
select t.denied('client cannot apply credit', $q$ select public.apply_credit((select id from public.invoices limit 1), 10) $q$);
select t.denied('client cannot reverse a deposit', $q$ select public.reverse_deposit((select id from public.deposits limit 1), 'x') $q$);
select t.back();

select t.act('b');
select t.eq('client B sees no deposits', t.n('select * from public.deposits'), 0);
select t.eq('client B sees no credit ledger rows', t.n($q$select * from public.ledger_entries where account_code = '2100'$q$), 0);
select t.eq('client B has zero credit', (select (public.client_credit_balance() * 100)::bigint), 0);
select t.denied('client B cannot read A balance', $q$ select public.client_credit_balance(t.cid('a')) $q$);
select t.back();

select t.act('pm');
select t.eq('project manager sees no deposits', t.n('select * from public.deposits'), 0);
select t.denied('project manager cannot record deposit', $q$ select public.record_deposit(t.cid('a'), 10, 'cash') $q$);
select t.denied('project manager cannot read a balance', $q$ select public.client_credit_balance(t.cid('a')) $q$);
select t.back();
select t.act('sup');
select t.eq('support officer sees no deposits', t.n('select * from public.deposits'), 0);
select t.denied('support officer cannot apply credit', $q$ select public.apply_credit((select id from public.invoices limit 1), 10) $q$);
select t.back();

-- ------------------------------------------------------------- applying credit
select t.act('acc');
select t.denied('record_payment cannot use account_credit', $q$ select public.record_payment((select id from public.invoices limit 1), 10, 'account_credit') $q$);
select t.denied('cannot apply more than the invoice owes', $q$ select public.apply_credit((select id from public.invoices limit 1), 700) $q$);
select t.allowed('top up so credit exceeds the invoice', $q$ select public.record_deposit(t.cid('a'), 300, 'cash', 'D2') $q$);
select t.denied('cannot apply more than the invoice owes (900 > 600)',
  $q$ select public.apply_credit((select id from public.invoices limit 1), 900) $q$);
select t.allowed('apply 500 of the 800 credit', $q$ select public.apply_credit((select id from public.invoices limit 1), 500) $q$);
select t.back();
select t.eq('invoice now has 900 paid and is partially paid',
  (select count(*) from public.invoices where amount_paid = 900 and status = 'partially_paid'), 1);
select t.eq('credit left is 300', (select (private.credit_balance(t.cid('a')) * 100)::bigint), 30000);
select t.eq('applied credit shows as a payment row', (select count(*) from public.payments where method = 'account_credit' and amount = 500), 1);

select t.act('acc');
select t.denied('cannot apply to an unknown invoice', $q$ select public.apply_credit(gen_random_uuid(), 10) $q$);
select t.allowed('settle the invoice with the remaining credit', $q$ select public.apply_credit((select id from public.invoices limit 1), 100) $q$);
select t.back();
select t.eq('invoice fully paid after the second credit application', (select count(*) from public.invoices where amount_paid = 1000 and status = 'paid'), 1);
select t.eq('credit left is 200', (select (private.credit_balance(t.cid('a')) * 100)::bigint), 20000);
select t.act('acc');
select t.denied('paid invoice cannot take more credit', $q$ select public.apply_credit((select id from public.invoices limit 1), 1) $q$);
select t.back();

-- ------------------------------------------------------------------ reversals
select t.act('acc');
select t.denied('cannot reverse a deposit without a reason', $q$ select public.reverse_deposit((select id from public.deposits where reference = 'D1'), '') $q$);
select t.denied('cannot reverse a deposit already spent (500 needed, 200 left)',
  $q$ select public.reverse_deposit((select id from public.deposits where reference = 'D1'), 'mistake') $q$);
select t.allowed('reverse the credit-applied 500 payment', $q$
  select public.reverse_payment((select id from public.payments where method = 'account_credit' and amount = 500), 'applied to the wrong invoice') $q$);
select t.back();
select t.eq('reversal returns the money to credit (700), not cash', (select (private.credit_balance(t.cid('a')) * 100)::bigint), 70000);
select t.eq('invoice back to 500 paid', (select count(*) from public.invoices where amount_paid = 500 and status = 'partially_paid'), 1);
select t.act('acc');
select t.allowed('reverse deposit D2 now that credit is available', $q$ select public.reverse_deposit((select id from public.deposits where reference = 'D2'), 'wrong client') $q$);
select t.denied('a reversed deposit cannot be reversed twice', $q$ select public.reverse_deposit((select id from public.deposits where reference = 'D2'), 'again') $q$);
select t.back();
select t.eq('credit after reversing D2', (select (private.credit_balance(t.cid('a')) * 100)::bigint), 40000);

-- --------------------------------------------------------------- integrity
select t.eq('ledger still balances (debits = credits)', (select (sum(debit) - sum(credit))::bigint from public.ledger_entries), 0);
select t.eq('every ledger row has an account code', (select count(*) from public.ledger_entries where account_code is null), 0);
select t.eq('every credit-ledger row after a deposit links a deposit or payment',
  (select count(*) from public.ledger_entries where account_code = '2100' and deposit_id is null and payment_id is null), 0);
select t.denied('ledger rows stay immutable', $q$ update public.ledger_entries set account_code = '1000' $q$);
select t.eq('deposits are audited', (select (count(*) > 0)::int::bigint from public.audit_logs where table_name = 'deposits'), 1);
select t.act('adm');
select t.eq('admin sees deposits', t.n('select * from public.deposits'), 2);
select t.back();
select t.act('acc');
select t.eq('accountant sees deposit audit rows', (t.n($q$select * from public.audit_logs where table_name = 'deposits'$q$) > 0)::int::bigint, 1);
select t.back();
select t.eq('credit notifications are queued for the client',
  (select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
    where p.email = 'a@x.test' and n.type = 'payment_received' and n.title like 'Deposit received%'), 2);

-- a client with no credit cannot have credit applied to their invoice
select t.act('acc');
select t.allowed('accountant drafts an invoice for B', $q$
  insert into public.invoices(client_id, subtotal, tax, total, line_items)
  values (t.cid('b'), 100, 0, 100, '[{"description":"Survey","amount":100}]'::jsonb) $q$);
select t.allowed('accountant issues B invoice', $q$
  select public.issue_invoice((select id from public.invoices where client_id = t.cid('b'))) $q$);
select t.denied('insufficient credit is rejected', $q$
  select public.apply_credit((select id from public.invoices where client_id = t.cid('b')), 50) $q$);
select t.back();
select t.eq('B invoice untouched by the failed attempt', (select count(*) from public.invoices where client_id = t.cid('b') and amount_paid = 0 and status = 'issued'), 1);
select t.eq('ledger balances at the end', (select (sum(debit) - sum(credit))::bigint from public.ledger_entries), 0);
