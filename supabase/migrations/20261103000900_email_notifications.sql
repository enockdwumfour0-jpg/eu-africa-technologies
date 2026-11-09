-- 009: email delivery for in-app notifications (Resend, via the send-notification-email edge function)
--  * every notification of an emailable type triggers the function (fire-and-forget, never blocks a write)

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net not available here (%); email triggers will be no-ops', sqlerrm;
end $$;

update public.app_settings
set value = value || '{"functions_url":"https://enlkrucktzppkyxrljpr.supabase.co/functions/v1/send-notification-email"}'::jsonb
where key = 'email';

create or replace function private.email_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare url text;
begin
  select value ->> 'functions_url' into url from public.app_settings where key = 'email';
  if url is null or to_regnamespace('net') is null then return null; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using url, jsonb_build_object('id', new.id), '{"Content-Type":"application/json"}'::jsonb;
  exception when others then
    null; -- email is best effort; the in-app notification is already saved
  end;
  return null;
end $$;

create trigger notifications_email after insert on public.notifications
  for each row
  when (new.type in ('registration_received','account_approved','account_rejected','project_assigned',
                     'project_update','message','document_approved','document_rejected','document_shared',
                     'invoice_issued','payment_received'))
  execute function private.email_notification();
