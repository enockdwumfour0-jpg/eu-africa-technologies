-- RLS / permission tests. Every check raises on failure (psql runs with ON_ERROR_STOP).
create schema t;
grant usage on schema t to public;
create table t.u (name text primary key, id uuid, email text);
grant select on t.u to public;

-- act as a user (JWT claims + authenticated role); t.back() returns to superuser
create function t.act(n text) returns void language plpgsql as $$
declare r t.u;
begin
  select * into r from t.u where name = n;
  perform set_config('request.jwt.claim.sub', r.id::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'email', r.email)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function t.back() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', false); perform set_config('request.jwt.claim.sub','',false); perform set_config('request.jwt.claims','',false); end $$;
create function t.n(q text) returns bigint language plpgsql as $$
declare c bigint; begin execute 'select count(*) from (' || q || ') x' into c; return c; end $$;
grant execute on all functions in schema t to public;

create function t.eq(label text, got bigint, want bigint) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL [%]: got %, want %', label, got, want; end if;
  raise notice 'ok   %', label;
end $$;
-- the statement must be rejected (exception or permission error)
create function t.denied(label text, q text) returns void language plpgsql as $$
declare c bigint;
begin
  begin execute q; get diagnostics c = row_count;
    -- an UPDATE/DELETE that RLS silently filters to 0 rows also counts as denied
    if c > 0 then raise exception 'FAIL [%]: statement was allowed (% rows)', label, c; end if;
  exception when others then
    if sqlerrm like 'FAIL [%' then raise; end if;
  end;
  raise notice 'ok   % (denied)', label;
end $$;
-- the statement must succeed
create function t.allowed(label text, q text) returns void language plpgsql as $$
begin execute q; raise notice 'ok   % (allowed)', label; end $$;
grant execute on all functions in schema t to public;

-- ------------------------------------------------------------------ fixtures
insert into auth.users(id, email, raw_app_meta_data) values
  (gen_random_uuid(), 'sa@x.test',  '{"provisioned_role":"super_admin"}'),
  (gen_random_uuid(), 'adm@x.test', '{"provisioned_role":"admin"}'),
  (gen_random_uuid(), 'pm@x.test',  '{"provisioned_role":"project_manager"}'),
  (gen_random_uuid(), 'pm2@x.test', '{"provisioned_role":"project_manager"}'),
  (gen_random_uuid(), 'acc@x.test', '{"provisioned_role":"accountant"}'),
  (gen_random_uuid(), 'sup@x.test', '{"provisioned_role":"support_officer"}');
insert into auth.users(id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'a@x.test', '{"full_name":"Client A","company":"A Ltd"}'),
  (gen_random_uuid(), 'b@x.test', '{"full_name":"Client B","company":"B Ltd"}'),
  (gen_random_uuid(), 'c@x.test', '{"full_name":"Client C"}');
insert into t.u select split_part(email,'@',1), id, email from auth.users;

select t.eq('public signup is a pending client',
  (select count(*) from public.profiles p join public.user_roles r on r.user_id = p.id
    where p.email = 'a@x.test' and p.status = 'pending' and r.role = 'client'), 1);
select t.eq('provisioned staff are active',
  (select count(*) from public.profiles where email in ('sa@x.test','adm@x.test','pm@x.test','acc@x.test','sup@x.test') and status = 'active'), 5);

-- ---------------------------------------------- pending client is locked out
select t.act('a');
select t.denied('pending client cannot self-approve',
  $q$ update public.profiles set status = 'active' where id = (select id from t.u where name='a') $q$);
select t.denied('client cannot grant themselves a role', $q$ update public.user_roles set role = 'super_admin' $q$);
select t.denied('client cannot insert a role', $q$ insert into public.user_roles(user_id, role) select id, 'admin' from t.u where name='a' $q$);
select t.denied('client cannot call set_user_role', $q$ select public.set_user_role((select id from t.u where name='a'), 'admin') $q$);
select t.denied('client cannot call review_client_application', $q$ select public.review_client_application((select id from t.u where name='a'), 'approved') $q$);
select t.eq('pending client has no client id', (select count(*) from public.projects), 0);
select t.denied('pending client cannot create a request',
  $q$ insert into public.project_requests(client_id, title, description) select id, 'x', 'y' from public.clients $q$);
select t.back();

-- ------------------------------------------------------------ approval flow
select t.act('sup');
select t.denied('support officer cannot approve clients', $q$ select public.review_client_application((select id from t.u where name='a'), 'approved') $q$);
select t.back();
select t.act('adm');
select t.allowed('admin approves A', $q$ select public.review_client_application((select id from t.u where name='a'), 'approved') $q$);
select t.allowed('admin approves B', $q$ select public.review_client_application((select id from t.u where name='b'), 'approved') $q$);
select t.allowed('admin rejects C',  $q$ select public.review_client_application((select id from t.u where name='c'), 'rejected', 'incomplete details') $q$);
select t.denied('admin cannot change own role', $q$ select public.set_user_role((select id from t.u where name='adm'), 'super_admin') $q$);
select t.denied('admin cannot touch staff accounts', $q$ select public.set_account_status((select id from t.u where name='acc'), 'suspended') $q$);
select t.back();
select t.eq('A is active after approval', (select count(*) from public.profiles where email='a@x.test' and status='active'), 1);
select t.eq('C is rejected', (select count(*) from public.profiles where email='c@x.test' and status='rejected'), 1);
select t.act('c');
select t.eq('rejected client sees nothing', t.n('select * from public.projects') + t.n('select * from public.clients'), 0);
select t.back();

select t.act('sa');
select t.allowed('super admin changes a staff role', $q$ select public.set_user_role((select id from t.u where name='sup'), 'support_officer') $q$);
select t.denied('super admin cannot change own role', $q$ select public.set_user_role((select id from t.u where name='sa'), 'admin') $q$);
select t.back();

-- ----------------------------------------------------------------- projects
select t.act('adm');
select t.allowed('admin creates project for A', $q$
  insert into public.projects(title, client_id) select 'Project A', c.id from public.clients c join public.profiles p on p.id=c.profile_id where p.email='a@x.test' $q$);
select t.allowed('admin creates project for B', $q$
  insert into public.projects(title, client_id) select 'Project B', c.id from public.clients c join public.profiles p on p.id=c.profile_id where p.email='b@x.test' $q$);
select t.allowed('admin assigns pm to Project A', $q$
  insert into public.project_members(project_id, user_id) select pr.id, (select id from t.u where name='pm') from public.projects pr where title='Project A' $q$);
select t.allowed('admin assigns pm2 to Project B', $q$
  insert into public.project_members(project_id, user_id) select pr.id, (select id from t.u where name='pm2') from public.projects pr where title='Project B' $q$);
select t.back();
select t.eq('milestones seeded on project creation', (select count(*) from public.project_milestones m join public.projects p on p.id=m.project_id where p.title='Project A'), 10);

select t.act('a');
select t.eq('client A sees only own project', t.n('select * from public.projects'), 1);
select t.eq('client A cannot see B project', t.n($q$select * from public.projects where title='Project B'$q$), 0);
select t.eq('client A sees only own milestones', t.n('select * from public.project_milestones'), 10);
select t.denied('client cannot create project', $q$ insert into public.projects(title, client_id) select 'Hack', id from public.clients $q$);
select t.denied('client cannot edit project', $q$ update public.projects set progress = 100, title = 'x' $q$);
select t.denied('client cannot edit milestones', $q$ update public.project_milestones set status = 'completed' $q$);
select t.denied('client cannot see other clients', $q$ select 1 from public.clients where profile_id <> auth.uid() having count(*) > 0 $q$);
select t.eq('client sees only own client row', t.n('select * from public.clients'), 1);
select t.eq('client cannot see other clients profiles', t.n($q$select * from public.profiles where email in ('b@x.test','c@x.test')$q$), 0);
select t.eq('client sees only own + assigned staff profile', t.n('select * from public.profiles'), 2);
select t.allowed('client submits a project request', $q$
  insert into public.project_requests(client_id, title, description) select id, 'Need a house', 'Details' from public.clients $q$);
select t.denied('client cannot submit a request as approved', $q$
  insert into public.project_requests(client_id, title, description, status) select id, 'x', 'y', 'approved' from public.clients $q$);
select t.denied('client cannot submit request for B', $q$
  insert into public.project_requests(client_id, title, description) select c.id, 'x', 'y' from public.clients c where c.profile_id <> auth.uid() $q$);
select t.back();

select t.act('pm');
select t.eq('pm sees only assigned project', t.n('select * from public.projects'), 1);
select t.eq('pm sees only assigned milestones', t.n('select * from public.project_milestones'), 10);
select t.allowed('pm updates a milestone on assigned project', $q$
  update public.project_milestones set status = 'completed' where position = 1 and project_id in (select id from public.projects) $q$);
select t.denied('pm cannot reassign client', $q$ update public.projects set client_id = (select id from public.clients where profile_id = (select id from t.u where name='b')) $q$);
select t.denied('pm cannot archive project', $q$ update public.projects set archived = true $q$);
select t.denied('pm cannot create project', $q$ insert into public.projects(title, client_id) select 'x', id from public.clients $q$);
select t.eq('pm cannot read invoices', t.n('select * from public.invoices'), 0);
select t.eq('pm cannot read audit logs', t.n('select * from public.audit_logs'), 0);
select t.eq('pm cannot read project requests', t.n('select * from public.project_requests'), 0);
select t.allowed('pm posts progress update', $q$
  insert into public.project_updates(project_id, author_id, title, body) select id, auth.uid(), 'Foundation poured', 'done' from public.projects $q$);
select t.back();
select t.eq('progress recalculated after milestone completion', (select progress::bigint from public.projects where title='Project A'), 10);

select t.act('pm2');
select t.denied('other pm cannot update A milestones', $q$ update public.project_milestones set status='completed' where project_id = (select id from public.projects where title='Project A') $q$);
select t.eq('other pm cannot read Project A', t.n($q$select * from public.projects where title='Project A'$q$), 0);
select t.back();

select t.act('b');
select t.eq('client B cannot see A updates', t.n('select * from public.project_updates'), 0);
select t.eq('client B cannot see A request', t.n('select * from public.project_requests'), 0);
select t.back();
select t.act('a');
select t.eq('client A sees progress update', t.n('select * from public.project_updates'), 1);
select t.back();

-- request workflow
select t.act('sup');
select t.eq('support officer sees requests', t.n('select * from public.project_requests'), 1);
select t.allowed('support officer adds internal note', $q$ insert into public.project_request_notes(request_id, author_id, note) select id, auth.uid(), 'looks fine' from public.project_requests $q$);
select t.denied('support officer cannot approve request', $q$ update public.project_requests set status = 'approved' $q$);
select t.back();
select t.act('a');
select t.eq('client cannot read internal notes', t.n('select * from public.project_request_notes'), 0);
select t.back();
select t.act('adm');
select t.allowed('admin approves request', $q$ update public.project_requests set status = 'approved' $q$);
select t.allowed('admin converts request to project', $q$ select public.convert_request_to_project((select id from public.project_requests limit 1), (select id from t.u where name='pm')) $q$);
select t.back();
select t.eq('converted project exists for A', (select count(*) from public.projects p join public.clients c on c.id=p.client_id join public.profiles pr on pr.id=c.profile_id where pr.email='a@x.test'), 2);

-- ---------------------------------------------------------------- documents
select t.act('a');
select t.allowed('client uploads own document', $q$
  insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
  select 'ID copy', id, 'from_client', id::text || '/id.pdf', 'id.pdf', 'application/pdf', 1000 from public.clients $q$);
select t.denied('client cannot upload for B', $q$
  insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
  select 'x', c.id, 'from_client', c.id::text || '/x.pdf', 'x.pdf', 'application/pdf', 10 from public.clients c where c.profile_id <> auth.uid() $q$);
select t.denied('client cannot use disallowed file type', $q$
  insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
  select 'x', id, 'from_client', id::text || '/x.exe', 'x.exe', 'application/x-msdownload', 10 from public.clients $q$);
select t.denied('client cannot approve own document', $q$ update public.documents set status = 'approved' $q$);
select t.eq('client A document starts pending', (select count(*) from public.documents where status='pending'), 1);
select t.back();
select t.act('adm');
select t.allowed('admin shares a document with A', $q$
  insert into public.documents(title, client_id, direction, storage_path, file_name, mime_type, size_bytes)
  select 'Contract', c.id, 'to_client', c.id::text || '/contract.pdf', 'contract.pdf', 'application/pdf', 5000
  from public.clients c join public.profiles p on p.id=c.profile_id where p.email='a@x.test' $q$);
select t.allowed('admin approves the uploaded document', $q$
  insert into public.document_reviews(document_id, reviewer_id, decision, comment)
  select id, auth.uid(), 'approved', 'ok' from public.documents where direction='from_client' $q$);
select t.back();
select t.eq('review flips document to approved', (select count(*) from public.documents where direction='from_client' and status='approved'), 1);
select t.act('b');
select t.eq('client B sees none of A documents', t.n('select * from public.documents'), 0);
select t.eq('client B sees none of A reviews', t.n('select * from public.document_reviews'), 0);
select t.back();
select t.act('a');
select t.eq('client A sees own documents', t.n('select * from public.documents'), 2);
select t.denied('client cannot review documents', $q$ insert into public.document_reviews(document_id, reviewer_id, decision) select id, auth.uid(), 'approved' from public.documents $q$);
select t.back();
select t.act('acc');
select t.eq('accountant cannot read documents', t.n('select * from public.documents'), 0);
select t.back();

-- ---------------------------------------------------------------- messaging
select t.act('a');
select t.allowed('client opens thread', $q$
  insert into public.message_threads(client_id, subject, created_by) select id, 'Question', auth.uid() from public.clients $q$);
select t.allowed('client sends message', $q$
  insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'Hello' from public.message_threads $q$);
select t.denied('client cannot message in B thread', $q$ insert into public.messages(thread_id, sender_id, body) values (gen_random_uuid(), auth.uid(), 'x') $q$);
select t.back();
select t.eq('message marked as not from staff', (select count(*) from public.messages where from_staff = false), 1);
create table t.thread as select id from public.message_threads;
grant select on t.thread to public;
select t.act('b');
select t.eq('client B cannot see A threads', t.n('select * from public.message_threads'), 0);
select t.eq('client B cannot see A messages', t.n('select * from public.messages'), 0);
select t.denied('client B cannot post in A thread', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'intrusion' from t.thread $q$);
select t.back();
select t.act('sup');
select t.eq('support officer sees thread', t.n('select * from public.message_threads'), 1);
select t.allowed('support officer replies', $q$ insert into public.messages(thread_id, sender_id, body) select id, auth.uid(), 'Hi, how can we help?' from public.message_threads $q$);
select t.back();
select t.eq('staff reply flagged from_staff', (select count(*) from public.messages where from_staff), 1);
select t.act('acc');
select t.eq('accountant cannot read messages', t.n('select * from public.messages'), 0);
select t.back();
select t.act('a');
select t.allowed('client marks thread read', $q$ select public.mark_thread_read((select id from public.message_threads limit 1)) $q$);
select t.eq('client sees both messages', t.n('select * from public.messages'), 2);
select t.back();

-- ------------------------------------------------------------ notifications
select t.act('a');
select t.eq('client sees only own notifications',
  t.n('select * from public.notifications where user_id <> auth.uid()'), 0);
select t.denied('client cannot create notifications', $q$ insert into public.notifications(user_id, type, title) values (auth.uid(), 't', 'x') $q$);
select t.denied('client cannot edit others notifications', $q$ update public.notifications set read_at = now() where user_id <> auth.uid() $q$);
select t.back();

-- ------------------------------------------------------------------ finance
select t.act('a');
select t.denied('client cannot create invoices', $q$ insert into public.invoices(client_id, subtotal, total) select id, 100, 100 from public.clients $q$);
select t.back();
select t.act('acc');
select t.allowed('accountant drafts invoice for A', $q$
  insert into public.invoices(client_id, subtotal, tax, total, line_items)
  select c.id, 1000, 0, 1000, '[{"description":"Deposit","amount":1000}]'::jsonb
  from public.clients c join public.profiles p on p.id=c.profile_id where p.email='a@x.test' $q$);
select t.back();
select t.act('a');
select t.eq('client cannot see draft invoice', t.n('select * from public.invoices'), 0);
select t.back();
select t.act('acc');
select t.allowed('accountant issues invoice', $q$ select public.issue_invoice((select id from public.invoices limit 1)) $q$);
select t.denied('issued invoice is locked', $q$ update public.invoices set total = 1, subtotal = 1 $q$);
select t.denied('accountant cannot forge payment rows', $q$ insert into public.payments(invoice_id, client_id, amount, method) select id, client_id, 5, 'cash' from public.invoices $q$);
select t.denied('accountant cannot forge ledger entries', $q$ insert into public.ledger_entries(entry_group, account_id, debit, description) select gen_random_uuid(), id, 5, 'x' from public.ledger_accounts limit 1 $q$);
select t.denied('payment above balance rejected', $q$ select public.record_payment((select id from public.invoices limit 1), 5000, 'cash') $q$);
select t.allowed('accountant records part payment', $q$ select public.record_payment((select id from public.invoices limit 1), 400, 'bank_transfer', 'REF1') $q$);
select t.back();
select t.eq('invoice partially paid', (select count(*) from public.invoices where status='partially_paid' and amount_paid=400), 1);
select t.eq('ledger balances (debits = credits)', (select sum(debit) - sum(credit) from public.ledger_entries)::bigint, 0);
select t.eq('ledger has 4 entries (issue + payment)', (select count(*) from public.ledger_entries), 4);
select t.denied('ledger is immutable even for superuser path', $q$ update public.ledger_entries set debit = debit $q$);

select t.act('a');
select t.eq('client A sees own invoice', t.n('select * from public.invoices'), 1);
select t.eq('client A sees own payment', t.n('select * from public.payments'), 1);
select t.eq('client A sees own ledger rows', t.n('select * from public.ledger_entries'), 4);
select t.eq('client cannot see chart of accounts', t.n('select * from public.ledger_accounts'), 0);
select t.denied('client cannot record payments', $q$ select public.record_payment((select id from public.invoices limit 1), 10, 'cash') $q$);
select t.back();
select t.act('b');
select t.eq('client B sees no finance rows', t.n('select * from public.invoices') + t.n('select * from public.payments') + t.n('select * from public.ledger_entries'), 0);
select t.back();
select t.act('pm');
select t.eq('pm sees no finance rows', t.n('select * from public.invoices') + t.n('select * from public.payments') + t.n('select * from public.ledger_entries'), 0);
select t.back();
select t.act('sup');
select t.eq('support officer sees no finance rows', t.n('select * from public.invoices') + t.n('select * from public.payments'), 0);
select t.back();

-- --------------------------------------------------- audit trail and privacy
select t.act('a');
select t.eq('client cannot read audit logs', t.n('select * from public.audit_logs'), 0);
select t.denied('client cannot tamper with audit logs', $q$ delete from public.audit_logs $q$);
select t.back();
select t.act('acc');
select t.eq('accountant sees only financial audit rows', t.n($q$select * from public.audit_logs where table_name not in ('invoices','payments','ledger_entries')$q$), 0);
select t.eq('accountant can see financial audit rows', (t.n('select * from public.audit_logs') > 0)::int::bigint, 1);
select t.back();
select t.act('adm');
select t.eq('admin can read audit logs', (t.n('select * from public.audit_logs') > 0)::int::bigint, 1);
select t.denied('admin cannot delete audit logs', $q$ delete from public.audit_logs $q$);
select t.back();
select t.eq('financial actions are audited', (select count(*) from public.audit_logs where table_name = 'invoices' and action = 'UPDATE'), 2);

-- ---------------------------------------------------------------- suspension
select t.act('adm');
select t.allowed('admin suspends client A', $q$ select public.set_account_status((select id from t.u where name='a'), 'suspended') $q$);
select t.back();
select t.act('a');
select t.eq('suspended client sees nothing',
  t.n('select * from public.projects') + t.n('select * from public.documents') + t.n('select * from public.invoices') + t.n('select * from public.message_threads'), 0);
select t.denied('suspended client cannot message', $q$ insert into public.message_threads(client_id, subject, created_by) select id, 'x', auth.uid() from public.clients $q$);
select t.back();

-- ---------------------------------------------------------------- settings
select t.eq('registration queued a welcome notification', (select count(*) from public.notifications where type = 'registration_received'), 3);
select t.act('b');
select t.eq('client reads only the public company profile', t.n('select * from public.app_settings'), 1);
select t.denied('client cannot change settings', $q$ update public.app_settings set value = '{}'::jsonb $q$);
select t.back();
select t.act('pm');
select t.eq('staff read all settings', t.n('select * from public.app_settings'), 4);
select t.denied('project manager cannot change settings', $q$ update public.app_settings set value = '{}'::jsonb $q$);
select t.back();
select t.act('adm');
select t.allowed('admin updates company settings', $q$ update public.app_settings set value = jsonb_set(value, '{phone}', '"0240000000"') where key = 'company' $q$);
select t.back();

-- ------------------------------------------------- embeds respect RLS (008)
select t.act('b');
select t.eq('client B sees the pm name on own project (embed)', t.n('select m.user_id, p.full_name from public.project_members m join public.profiles p on p.id = m.user_id'), 1);
select t.eq('client B sees no staff names for A projects', t.n($q$select 1 from public.project_members m join public.profiles p on p.id = m.user_id where m.project_id in (select id from public.projects where title = 'Project A')$q$), 0);
select t.back();
