-- Messaging end to end, Paystack settlement and editable website content.
-- Runs after 20_credit_tests.sql and reuses its users (a, b, adm, acc, pm, sup, sa).

-- ============================================================ messaging
-- A fresh thread for client B, so counts below do not depend on earlier files
select t.act('b');
select t.allowed('B opens a thread', $q$ insert into public.message_threads(client_id, subject, created_by) values (t.cid('b'), 'Survey question', auth.uid()) $q$);
select t.allowed('B sends the first message', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'When can you visit?' from public.message_threads where subject = 'Survey question' $q$);
select t.allowed('B tries to spoof the sender (the server overrides it)', $q$ insert into public.messages(thread_id, sender_id, body) select id, (select id from t.u where name='a'), 'spoof' from public.message_threads where subject = 'Survey question' $q$);
select t.eq('sender is always the real user, never the spoofed one', t.n($q$select * from public.messages m where m.body = 'spoof' and m.sender_id = auth.uid() and not m.from_staff$q$), 1);
select t.denied('B cannot send an empty message', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), null from public.message_threads where subject = 'Survey question' $q$);
select t.back();
select t.eq('staff were notified of the new message',
  (select count(*) from public.notifications where type = 'message' and title like 'New client message: Survey question%'
     and user_id in (select id from t.u where name in ('adm','sa','sup'))), 6);
select t.eq('project manager is not notified of a non-project thread',
  (select count(*) from public.notifications where type = 'message' and title like 'New client message: Survey question%'
     and user_id = (select id from t.u where name = 'pm')), 0);

select t.act('a');
select t.eq('client A cannot see B thread', t.n($q$select * from public.message_threads where subject = 'Survey question'$q$), 0);
select t.denied('client A cannot post in B thread', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'x' from public.message_threads where subject = 'Survey question' $q$);
select t.back();

select t.act('sup');
select t.allowed('support replies', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'Tomorrow at 10' from public.message_threads where subject = 'Survey question' $q$);
select t.back();
select t.eq('B gets a notification for the reply',
  (select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
    where p.email = 'b@x.test' and n.type = 'message' and n.title like 'New message: Survey question%'), 1);

select t.act('b');
select t.eq('B has 1 unread staff message', t.n($q$select * from public.messages where read_at is null and from_staff$q$), 1);
select t.allowed('B marks the thread read', $q$ select public.mark_thread_read((select id from public.message_threads where subject = 'Survey question')) $q$);
select t.eq('B has 0 unread after reading', t.n($q$select * from public.messages where read_at is null and from_staff$q$), 0);
select t.denied('B cannot edit a message body', $q$ update public.messages set body = 'changed' $q$);
select t.denied('B cannot delete messages', $q$ delete from public.messages $q$);
select t.denied('B cannot close the thread', $q$ update public.message_threads set status = 'closed' $q$);
select t.back();

select t.act('sup');
select t.allowed('support closes the thread', $q$ update public.message_threads set status = 'closed' where subject = 'Survey question' $q$);
select t.back();
select t.act('b');
select t.denied('no messages in a closed thread', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'still there?' from public.message_threads where subject = 'Survey question' $q$);
select t.back();
select t.act('acc');
select t.eq('accountant cannot read messages', t.n('select * from public.messages'), 0);
select t.back();

-- ============================================================ editable website content
select t.act('b');
select t.denied('client cannot write page text', $q$ insert into public.site_content(key, page, value) values ('home.h1.1', 'home', 'hacked') $q$);
select t.back();
select t.act('pm');
select t.denied('project manager cannot write page text', $q$ insert into public.site_content(key, page, value) values ('home.h1.1', 'home', 'hacked') $q$);
select t.back();
select t.act('adm');
select t.denied('admin cannot edit page text', $q$ insert into public.site_content(key, page, value) values ('home.h1.1', 'home', 'admin attempt') $q$);
select t.denied('admin cannot edit the team list', $q$ insert into public.team_members(name, section) values ('X', 'team') $q$);
select t.back();
select t.act('sa');
select t.allowed('super admin edits a heading', $q$ insert into public.site_content(key, page, value) values ('home.h1.1', 'home', 'New headline') $q$);
select t.denied('malformed key rejected', $q$ insert into public.site_content(key, page, value) values ('bad key', 'home', 'x') $q$);
select t.denied('empty text rejected', $q$ insert into public.site_content(key, page, value) values ('home.h2.1', 'home', '') $q$);
select t.denied('external image URL rejected', $q$ insert into public.site_content(key, page, value) values ('our-team.img.1', 'our-team', 'https://evil.example/x.jpg') $q$);
select t.allowed('own-storage image accepted', $q$ insert into public.site_content(key, page, value)
  values ('our-team.img.1', 'our-team', 'https://enlkrucktzppkyxrljpr.supabase.co/storage/v1/object/public/gallery/site/1-abc.jpg') $q$);
select t.allowed('super admin resets a heading', $q$ delete from public.site_content where key = 'home.h1.1' $q$);
select t.back();
select t.eq('content edits are audited', (select (count(*) >= 2)::int::bigint from public.audit_logs where table_name = 'site_content'), 1);

-- ============================================================ Paystack
select t.act('adm');
select t.eq('admin cannot read Paystack config', t.n('select * from public.paystack_config'), 0);
select t.back();
select t.act('sa');
select t.eq('super admin reads Paystack config', t.n('select * from public.paystack_config'), 1);
select t.denied('commission above 30% rejected', $q$ update public.paystack_config set commission_percent = 50 $q$);
select t.denied('commission without a subaccount cannot be enabled', $q$ update public.paystack_config set enabled = true, commission_percent = 5 $q$);
select t.denied('malformed subaccount rejected', $q$ update public.paystack_config set subaccount_code = 'x; drop table' $q$);
select t.back();
select t.act('a');
select t.eq('online payments report off by default', (select (not public.online_payments_enabled())::int::bigint), 1);
select t.denied('client cannot read the config', $q$ select * from public.paystack_config where enabled is not null having count(*) > 0 $q$);
select t.denied('client cannot settle a payment', $q$ select public.settle_online_payment('EAT-X', '1', 100, 'GHS', 'card', 0) $q$);
select t.back();
select t.act('acc');
select t.denied('accountant cannot settle a payment', $q$ select public.settle_online_payment('EAT-X', '1', 100, 'GHS', 'card', 0) $q$);
select t.back();

-- invoices for the settlement scenarios (issued directly by the superuser fixture)
create table t.ps (name text primary key, inv uuid);
insert into public.invoices(client_id, subtotal, tax, total, line_items, status, issue_date, due_date)
  select t.cid('b'), 1000, 0, 1000, '[]', 'issued', current_date, current_date + 7 from generate_series(1,1);
insert into t.ps select 'main', id from public.invoices where client_id = t.cid('b') and total = 1000 and status = 'issued' limit 1;
grant select on t.ps to public;
insert into public.online_payments(reference, invoice_id, client_id, amount, commission_percent, commission)
  select 'EAT-TEST000000001', inv, t.cid('b'), 1000, 10, 100 from t.ps where name = 'main';
insert into public.online_payments(reference, invoice_id, client_id, amount) select 'EAT-TEST000000002', inv, t.cid('b'), 1000 from t.ps where name = 'main';
insert into public.online_payments(reference, invoice_id, client_id, amount) select 'EAT-TEST000000003', inv, t.cid('b'), 1000 from t.ps where name = 'main';
insert into public.online_payments(reference, invoice_id, client_id, amount) select 'EAT-TEST000000004', inv, t.cid('b'), 1000 from t.ps where name = 'main';

do $$ begin
  begin perform public.settle_online_payment('EAT-NOPE', '1', 100, 'GHS', 'card', 0); raise exception 'FAIL [unknown reference allowed]';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'ok   unknown reference rejected';
  if public.settle_online_payment('EAT-TEST000000002', '2', 100000, 'USD', 'card', 0) <> 'flagged' then raise exception 'FAIL [usd not flagged]'; end if;
  raise notice 'ok   wrong currency is flagged, not recorded';
  if public.settle_online_payment('EAT-TEST000000001', '1', 100000, 'GHS', 'card', 150) <> 'payment' then raise exception 'FAIL [normal settlement]'; end if;
  raise notice 'ok   normal payment recorded';
  if public.settle_online_payment('EAT-TEST000000001', '1', 100000, 'GHS', 'card', 150) <> 'already' then raise exception 'FAIL [not idempotent]'; end if;
  raise notice 'ok   second confirmation is a no-op';
  if public.settle_online_payment('EAT-TEST000000003', '3', 100000, 'GHS', 'card', 0) <> 'credit' then raise exception 'FAIL [paid invoice should go to credit]'; end if;
  raise notice 'ok   payment for an already-paid invoice is kept as credit';
  if public.settle_online_payment('EAT-TEST000000004', '4', 90000, 'GHS', 'card', 0) <> 'credit' then raise exception 'FAIL [underpayment should go to credit]'; end if;
  raise notice 'ok   different amount is kept as credit';
end $$;
select t.eq('invoice is paid exactly once', (select count(*) from public.invoices i join t.ps on t.ps.inv = i.id where i.status = 'paid' and i.amount_paid = 1000), 1);
select t.eq('exactly one Paystack payment row', (select count(*) from public.payments where method = 'paystack'), 1);
select t.eq('credit for the extra payments is 1900', (select (private.credit_balance(t.cid('b')) * 100)::bigint), 190000);
select t.eq('flagged payment left unrecorded', (select count(*) from public.online_payments where reference = 'EAT-TEST000000002' and status = 'initiated' and note is not null), 1);
select t.eq('admins were told about the problem payment',
  (select (count(*) >= 3)::int::bigint from public.notifications where title = 'Online payment needs attention'), 1);
select t.eq('ledger still balances', (select (sum(debit) - sum(credit))::bigint from public.ledger_entries), 0);
select t.act('b');
select t.eq('client cannot see online payment rows (commission is private)', t.n('select * from public.online_payments'), 0);
select t.back();
select t.act('acc');
select t.eq('accountant sees online payment rows', (t.n('select * from public.online_payments') >= 4)::int::bigint, 1);
select t.denied('accountant cannot edit online payment rows', $q$ update public.online_payments set status = 'success' $q$);
select t.back();
