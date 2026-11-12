-- Agent chat, resources library, tiers and targets. Runs after 40_agent_tests.sql (agent g1 is suspended there; g2 is active).
select t.act('adm');
select t.allowed('admin sets a monthly target for agent two', $q$ update public.agents set monthly_target = 2000, default_rate = 5 where user_id = (select id from t.u where name='g2') $q$);
select t.allowed('admin adds a tier: 1000 -> +2 points', $q$ insert into public.commission_tiers(min_monthly, bonus_rate) values (1000, 2) $q$);
select t.allowed('admin adds a tier: 3000 -> +4 points', $q$ insert into public.commission_tiers(min_monthly, bonus_rate) values (3000, 4) $q$);
select t.denied('duplicate tier threshold', $q$ insert into public.commission_tiers(min_monthly, bonus_rate) values (1000, 5) $q$);
select t.back();
select t.act('g2');
select t.eq('agent reads the tiers', t.n('select * from public.commission_tiers'), 2);
select t.denied('agent cannot edit tiers', $q$ update public.commission_tiers set bonus_rate = 40 $q$);
select t.denied('agent cannot set own target', $q$ update public.agents set monthly_target = 1 $q$);
select t.back();

-- client A belongs to agent two (assigned in 40_agent_tests). A pays enough to cross the 1000 tier.
select t.act('adm');
select t.allowed('admin assigns client B to agent two as well', $q$ update public.clients set agent_id = (select id from t.u where name='g2') where id = t.cid('b') $q$);
select t.back();
select t.act('acc');
select t.allowed('B invoice 2000', $q$ insert into public.invoices(client_id, subtotal, tax, total, line_items) values (t.cid('b'), 2000, 0, 2000, '[]') $q$);
select t.allowed('issue it', $q$ select public.issue_invoice((select id from public.invoices where client_id = t.cid('b') and total = 2000)) $q$);
select t.allowed('B pays 500 (below the first tier)', $q$ select public.record_payment((select id from public.invoices where client_id = t.cid('b') and total = 2000), 500, 'cash') $q$);
select t.allowed('B pays 700 more (month total 1200: first tier)', $q$ select public.record_payment((select id from public.invoices where client_id = t.cid('b') and total = 2000), 700, 'cash') $q$);
select t.back();
select t.eq('first payment earns the base 5%', (select count(*) from public.commission_entries where agent_id = (select id from t.u where name='g2') and base_amount = 500 and rate = 5 and bonus_rate = 0 and amount = 25), 1);
select t.eq('second payment earns 5% + 2 points', (select count(*) from public.commission_entries where agent_id = (select id from t.u where name='g2') and base_amount = 700 and rate = 7 and bonus_rate = 2 and amount = 49), 1);
select t.act('g2');
select t.eq('overview shows progress to target and tier',
  (select count(*) from (select public.agent_overview() o) x where (o ->> 'target')::numeric = 2000 and (o ->> 'bonus_now')::numeric = 2 and (o ->> 'next_min')::numeric = 3000 and (o ->> 'month_collected')::numeric >= 1200), 1);
select t.back();

-- ------------------------------------------------ chat with the office
select t.act('g2');
select t.allowed('agent opens a chat with the office', $q$ insert into public.message_threads(agent_id, subject, created_by) values (auth.uid(), 'Agent Two', auth.uid()) $q$);
select t.allowed('agent sends a message', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'Hello office' from public.message_threads where agent_id = auth.uid() $q$);
select t.denied('agent cannot open a thread as a client', $q$ insert into public.message_threads(client_id, subject, created_by) values (t.cid('a'), 'x', auth.uid()) $q$);
select t.denied('agent cannot open a thread for another agent', $q$ insert into public.message_threads(agent_id, subject, created_by) select id, 'x', auth.uid() from t.u where name = 'g1' $q$);
select t.eq('agent sees only their own thread', t.n('select * from public.message_threads'), 1);
select t.back();
select t.eq('office was notified', (select count(*) from public.notifications where title = 'New agent message: Agent Two' and user_id = (select id from t.u where name = 'adm')), 1);
select t.act('sup');
select t.eq('support officer sees the agent thread', t.n($q$select * from public.message_threads where agent_id is not null$q$), 1);
select t.allowed('support officer replies', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'Hi, how can we help?' from public.message_threads where agent_id is not null $q$);
select t.back();
select t.eq('agent was notified of the reply', (select count(*) from public.notifications where title = 'New message from the EU-AFRIC office' and user_id = (select id from t.u where name = 'g2')), 1);
select t.act('g2');
select t.allowed('agent marks the thread read', $q$ select public.mark_thread_read((select id from public.message_threads where agent_id = auth.uid())) $q$);
select t.eq('the office reply is now read', t.n($q$select * from public.messages where from_staff and read_at is not null$q$), 1);
select t.back();
select t.act('g1');
select t.eq('another (suspended) agent sees no threads', t.n('select * from public.message_threads') + t.n('select * from public.messages'), 0);
select t.back();
select t.act('b');
select t.eq('a client never sees agent threads', t.n($q$select * from public.message_threads where agent_id is not null$q$), 0);
select t.back();

-- ------------------------------------------------ resources
select t.act('adm');
select t.allowed('admin adds a resource', $q$ insert into public.agent_resources(title, category, storage_path, file_name, mime_type, size_bytes, created_by) values ('Price list 2026', 'Price lists', 'x/pl.pdf', 'pl.pdf', 'application/pdf', 1000, auth.uid()) $q$);
select t.allowed('admin adds a hidden draft', $q$ insert into public.agent_resources(title, storage_path, file_name, mime_type, size_bytes, published) values ('Draft', 'x/d.pdf', 'd.pdf', 'application/pdf', 1000, false) $q$);
select t.back();
select t.act('sup');
select t.denied('support officer cannot add resources (real)', $q$ insert into public.agent_resources(title, storage_path, file_name, mime_type, size_bytes) values ('x', 'x/y.pdf', 'y.pdf', 'application/pdf', 1) $q$);
select t.back();
select t.eq('agents were told about the new resource', (select count(*) from public.notifications where type = 'agent_resource' and title = 'New resource: Price list 2026'), 2);
select t.act('g2');
select t.eq('agent sees published resources only', t.n('select * from public.agent_resources'), 1);
select t.denied('agent cannot add resources', $q$ insert into public.agent_resources(title, storage_path, file_name, mime_type, size_bytes) values ('x', 'x/y.pdf', 'y.pdf', 'application/pdf', 1) $q$);
select t.back();
select t.act('a');
select t.eq('clients cannot see resources', t.n('select * from public.agent_resources'), 0);
select t.back();
