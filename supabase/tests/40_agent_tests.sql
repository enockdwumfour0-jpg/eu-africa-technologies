-- Agents: referral, commission accrual/reversal, payouts, and what an agent can and cannot see.
-- Runs after the earlier files and reuses their users (a, b, adm, acc, pm, sup, sa).
insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values
  (gen_random_uuid(), 'g1@x.test', '{"provisioned_role":"agent"}', '{"full_name":"Agent One"}'),
  (gen_random_uuid(), 'g2@x.test', '{"provisioned_role":"agent"}', '{"full_name":"Agent Two"}');
insert into t.u select split_part(email,'@',1), id, email from auth.users where email in ('g1@x.test','g2@x.test');

select t.eq('agent accounts are active with a referral code',
  (select count(*) from public.agents a join public.profiles p on p.id = a.user_id where p.status = 'active' and a.code ~ '^EA[A-Z0-9]{6}$'), 2);

-- a client who signs up with agent one's code is linked immediately; a bad code is ignored
insert into auth.users(id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'd@x.test', jsonb_build_object('full_name','Client D','company','D Ltd','agent_code',
    (select lower(code) || ' ' from public.agents where user_id = (select id from t.u where name='g1')))),
  (gen_random_uuid(), 'e@x.test', '{"full_name":"Client E","agent_code":"NOPE9999"}');
insert into t.u select split_part(email,'@',1), id, email from auth.users where email in ('d@x.test','e@x.test');
insert into t.c select split_part(p.email, '@', 1), c.id from public.clients c join public.profiles p on p.id = c.profile_id where p.email in ('d@x.test','e@x.test');
select t.eq('referral code links client D to agent one',
  (select count(*) from public.clients c where c.profile_id = (select id from t.u where name='d') and c.agent_id = (select id from t.u where name='g1')), 1);
select t.eq('unknown code leaves client E unassigned',
  (select count(*) from public.clients c where c.profile_id = (select id from t.u where name='e') and c.agent_id is null), 1);
select t.eq('agent was told about the new sign-up',
  (select count(*) from public.notifications where type = 'agent_referral' and user_id = (select id from t.u where name='g1')), 1);

select t.act('adm');
select t.allowed('admin approves D', $q$ select public.review_client_application((select id from t.u where name='d'), 'approved') $q$);
select t.allowed('admin gives agent one a 10% rate for Solar', $q$ insert into public.agent_rates(agent_id, product, rate) select id, 'Solar', 10 from t.u where name = 'g1' $q$);
select t.allowed('admin sets default rate 4', $q$ update public.agents set default_rate = 4 where user_id = (select id from t.u where name='g1') $q$);
select t.denied('duplicate product rate (case-insensitive)', $q$ insert into public.agent_rates(agent_id, product, rate) select id, ' solar ', 3 from t.u where name = 'g1' $q$);
select t.allowed('admin assigns client A to agent two', $q$ update public.clients set agent_id = (select id from t.u where name='g2') where id = t.cid('a') $q$);
select t.back();
select t.eq('agent one told that D was approved', (select count(*) from public.notifications where type = 'agent_client_approved' and user_id = (select id from t.u where name='g1')), 1);

-- invoices for D: one Solar (10%), one other product (default 4%)
select t.act('acc');
select t.allowed('accountant drafts D solar invoice', $q$ insert into public.invoices(client_id, subtotal, tax, total, line_items, product) values (t.cid('d'), 1000, 0, 1000, '[]', 'Solar') $q$);
select t.allowed('accountant drafts D other invoice', $q$ insert into public.invoices(client_id, subtotal, tax, total, line_items, product) values (t.cid('d'), 500, 0, 500, '[]', 'Surveying') $q$);
select t.allowed('issue solar', $q$ select public.issue_invoice((select id from public.invoices where client_id = t.cid('d') and product = 'Solar')) $q$);
select t.allowed('issue other', $q$ select public.issue_invoice((select id from public.invoices where client_id = t.cid('d') and product = 'Surveying')) $q$);
select t.allowed('D pays 400 of solar', $q$ select public.record_payment((select id from public.invoices where client_id = t.cid('d') and product = 'Solar'), 400, 'cash') $q$);
select t.allowed('D pays 500 of other', $q$ select public.record_payment((select id from public.invoices where client_id = t.cid('d') and product = 'Surveying'), 500, 'cash') $q$);
select t.back();
select t.eq('solar payment earns 40 (10%)', (select count(*) from public.commission_entries where agent_id = (select id from t.u where name='g1') and amount = 40 and rate = 10 and product = 'Solar'), 1);
select t.eq('other payment earns 20 (default 4%)', (select count(*) from public.commission_entries where agent_id = (select id from t.u where name='g1') and amount = 20 and rate = 4), 1);
select t.eq('client A (agent two) earlier payments are not credited to agent one',
  (select count(*) from public.commission_entries where client_id = t.cid('a') and agent_id = (select id from t.u where name='g1')), 0);

-- ------------------------------------------------ what agent one can see
select t.act('g1');
select t.eq('agent sees exactly their own clients', t.n('select * from public.clients'), 1);
select t.eq('agent cannot see client A', t.n($q$select * from public.clients where id = t.cid('a')$q$), 0);
select t.eq('agent cannot read any invoice', t.n('select * from public.invoices'), 0);
select t.eq('agent cannot read any payment', t.n('select * from public.payments'), 0);
select t.eq('agent cannot read messages', t.n('select * from public.message_threads') + t.n('select * from public.messages'), 0);
select t.eq('agent cannot read others profiles', t.n($q$select * from public.profiles where email in ('a@x.test','b@x.test','acc@x.test')$q$), 0);
select t.eq('agent can read the client profile', t.n($q$select * from public.profiles where email = 'd@x.test'$q$), 1);
select t.eq('agent sees only own commission rows', t.n('select * from public.commission_entries'), 2);
select t.eq('agent sees own rates only', t.n('select * from public.agent_rates'), 1);
select t.eq('agent sees only own agent row', t.n('select * from public.agents'), 1);
select t.eq('overview: earned 60', ((select public.agent_overview() ->> 'earned')::numeric)::bigint, 60);
select t.eq('client overview shows totals for D', (select count(*) from public.agent_client_overview() where invoiced = 1500 and paid = 900 and outstanding = 600 and commission = 60), 1);
select t.denied('agent cannot write commission', $q$ insert into public.commission_entries(agent_id, base_amount, rate, amount) select id, 1, 1, 1 from t.u where name='g1' $q$);
select t.denied('agent cannot change own rate', $q$ update public.agents set default_rate = 90 $q$);
select t.denied('agent cannot change a rate row', $q$ update public.agent_rates set rate = 90 $q$);
select t.denied('agent cannot pay themselves', $q$ select public.record_commission_payout((select id from t.u where name='g1'), 10, 'cash') $q$);
select t.denied('agent cannot reassign a client', $q$ update public.clients set agent_id = (select id from t.u where name='g2') $q$);
select t.denied('agent cannot create a project', $q$ insert into public.projects(title, client_id) values ('x', t.cid('d')) $q$);
select t.allowed('agent saves payout details', $q$ select public.update_my_agent_details('Prime Realty', 'MoMo 024 000 0000') $q$);
select t.allowed('agent logs a lead', $q$ insert into public.agent_leads(agent_id, name, phone) values (auth.uid(), 'Kofi', '0240000000') $q$);
select t.denied('agent cannot log a lead for another agent', $q$ insert into public.agent_leads(agent_id, name) select id, 'x' from t.u where name = 'g2' $q$);
select t.eq('agent sees only own leads', t.n('select * from public.agent_leads'), 1);
select t.denied('agent is not staff: cannot read audit logs', $q$ select 1 from public.audit_logs limit 1 $q$ ) ;
select t.back();

-- ------------------------------------------------ projects and files for the agent's client
select t.act('adm');
select t.allowed('admin creates a project for D', $q$ insert into public.projects(title, client_id) values ('Project D', t.cid('d')) $q$);
select t.allowed('admin posts a client-visible update', $q$ insert into public.project_updates(project_id, author_id, title, visible_to_client) select id, auth.uid(), 'Site visit done', true from public.projects where title = 'Project D' $q$);
select t.allowed('admin posts an internal note', $q$ insert into public.project_updates(project_id, author_id, title, visible_to_client) select id, auth.uid(), 'Internal', false from public.projects where title = 'Project D' $q$);
select t.allowed('admin creates a project for B', $q$ insert into public.projects(title, client_id) values ('Project B2', t.cid('b')) $q$);
select t.back();
select t.act('g1');
select t.eq('agent sees the client project, not others', t.n('select * from public.projects'), 1);
select t.eq('agent sees its milestones', (t.n('select * from public.project_milestones') > 0)::int::bigint, 1);
select t.eq('agent sees only client-visible updates', t.n('select * from public.project_updates'), 1);
select t.denied('agent cannot edit milestones', $q$ update public.project_milestones set status = 'completed' $q$);
select t.allowed('agent uploads a file for own client',
  $q$ insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
      values ('Site plan', t.cid('d'), 'from_client', t.cid('d') || '/plan.pdf', 'plan.pdf', 'application/pdf', 1000) $q$);
select t.denied('agent cannot upload for a stranger client',
  $q$ insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
      values ('x', t.cid('b'), 'from_client', t.cid('b') || '/x.pdf', 'x.pdf', 'application/pdf', 1000) $q$);
select t.denied('agent cannot publish documents to a client',
  $q$ insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
      values ('x', t.cid('d'), 'to_client', t.cid('d') || '/y.pdf', 'y.pdf', 'application/pdf', 1000) $q$);
select t.eq('upload is forced to pending review', t.n($q$select * from public.documents where title = 'Site plan' and status = 'pending'$q$), 1);
select t.eq('agent sees only own uploads', t.n('select * from public.documents'), 1);
select t.allowed('agent may put the file in the client folder of storage',
  $q$ insert into storage.objects(bucket_id, name, owner) values ('documents', t.cid('d') || '/plan.pdf', auth.uid()) $q$);
select t.denied('agent cannot put files in another client folder',
  $q$ insert into storage.objects(bucket_id, name, owner) values ('documents', t.cid('b') || '/plan.pdf', auth.uid()) $q$);
select t.back();
select t.eq('admins were told about the upload', ((select count(*) from public.notifications where type = 'document_uploaded' and title = 'Client uploaded: Site plan') > 0)::int::bigint, 1);
select t.act('g2');
select t.eq('agent two sees none of agent one data', t.n('select * from public.projects') + t.n('select * from public.documents') + t.n('select * from public.commission_entries'), t.n($q$select * from public.projects where client_id = t.cid('a')$q$));
select t.back();

-- ------------------------------------------------ reversal and payouts
select t.act('acc');
select t.allowed('reverse the 400 solar payment', $q$ select public.reverse_payment((select id from public.payments where client_id = t.cid('d') and amount = 400), 'bounced') $q$);
select t.back();
select t.eq('reversal cancels that commission', (select count(*) from public.commission_entries where amount = 40 and status = 'reversed' and reversed_at is not null), 1);
select t.act('g1');
select t.eq('earned now 20', ((select public.agent_overview() ->> 'earned')::numeric)::bigint, 20);
select t.back();
select t.act('acc');
select t.denied('payout above balance is refused', $q$ select public.record_commission_payout((select id from t.u where name='g1'), 25, 'cash') $q$);
select t.allowed('accountant records a payout of 15', $q$ select public.record_commission_payout((select id from t.u where name='g1'), 15, 'mobile_money', 'MM123') $q$);
select t.back();
select t.act('sup');
select t.denied('support officer cannot record payouts (real)', $q$ select public.record_commission_payout((select id from t.u where name='g1'), 1, 'cash') $q$);
select t.eq('support officer cannot see commission', t.n('select * from public.commission_entries') + t.n('select * from public.commission_payouts'), 0);
select t.back();
select t.act('g1');
select t.eq('agent pending balance is 5', ((select public.agent_overview() ->> 'pending')::numeric)::bigint, 5);
select t.eq('agent sees the payout', t.n('select * from public.commission_payouts'), 1);
select t.denied('agent cannot edit payouts', $q$ update public.commission_payouts set amount = 1000 $q$);
select t.back();

-- ------------------------------------------------ suspension
select t.act('adm');
select t.allowed('admin suspends agent one', $q$ update public.agents set status = 'suspended' where user_id = (select id from t.u where name='g1') $q$);
select t.back();
select t.act('g1');
select t.eq('suspended agent sees no clients or projects', t.n('select * from public.clients') + t.n('select * from public.projects'), 0);
select t.denied('suspended agent cannot call the dashboard', $q$ select public.agent_overview() $q$);
select t.back();
