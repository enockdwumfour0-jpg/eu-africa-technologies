-- 007: system settings (company info, notification toggles, email, preferences)

create table public.app_settings (
  key text primary key check (char_length(key) <= 60),
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key, value) values
  ('company', '{"name":"EU-AFRIC Technologies Ltd","email":"info@eatl.co.com","phone":"","address":"","website":"https://eatl.co.com","tagline":""}'),
  ('notifications', '{"email_enabled":true,"types":{"registration_received":true,"account_approved":true,"account_rejected":true,"project_assigned":true,"project_update":true,"new_message":true,"document_approved":true,"document_rejected":true,"document_shared":true,"invoice_issued":true,"payment_received":true}}'),
  ('email', '{"from_name":"EU-AFRIC Technologies","reply_to":"info@eatl.co.com"}'),
  ('system', '{"currency":"GHS","invoice_due_days":14,"tax_rate_percent":0}');

create trigger app_settings_updated before update on public.app_settings
  for each row execute function private.set_updated_at();
create trigger audit_app_settings after insert or update on public.app_settings
  for each row execute function private.audit();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
-- staff read everything; every signed-in user may read the public company profile only
create policy settings_select on public.app_settings for select to authenticated
  using (private.is_staff() or key = 'company');
create policy settings_insert on public.app_settings for insert to authenticated
  with check (private.is_admin_or_above());
create policy settings_update on public.app_settings for update to authenticated
  using (private.is_admin_or_above()) with check (private.is_admin_or_above());
revoke delete on public.app_settings from authenticated;
