-- Account deletion. Personal data is erased; financial/ledger/project records are kept but
-- anonymised (they must survive for accounting), because they point at the person's id.
alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.erase_account(p_user uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.app_role; cl uuid;
begin
  select role into r from public.user_roles where user_id = p_user;
  if r = 'super_admin' then raise exception 'The Super Administrator account cannot be deleted'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Account not found'; end if;

  select id into cl from public.clients where profile_id = p_user;
  if cl is not null and exists (select 1 from public.invoices where client_id = cl
       and status not in ('paid','cancelled','draft','void') and total > amount_paid) then
    raise exception 'This client has unpaid invoices. Settle or cancel them first';
  end if;

  update public.profiles set full_name = 'Deleted user', email = 'deleted-' || p_user || '@deleted.invalid',
    phone = null, company = null, avatar_path = null, job_title = null, rejection_reason = null,
    status = 'suspended', notification_prefs = '{"email":false,"in_app":false}'::jsonb, deleted_at = now()
  where id = p_user;
  update public.clients set company_name = null, address = null where profile_id = p_user;
  update public.agents set agency = null, payout_details = null, notes = null, status = 'suspended' where user_id = p_user;
  delete from public.agent_leads where agent_id = p_user;
  delete from public.user_roles where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.message_hides where user_id = p_user;
  delete from public.staff_agent_contacts where staff_id = p_user;
  delete from public.project_members where user_id = p_user;
  delete from public.client_applications where user_id = p_user;
  update public.messages set body = '[message deleted]', attachment_path = null, attachment_name = null where sender_id = p_user;
  return coalesce(r::text, 'client');
end $$;
revoke all on function public.erase_account(uuid) from public, anon, authenticated;
grant execute on function public.erase_account(uuid) to service_role;

-- A deleted account may never be reactivated.
create or replace function private.block_reactivate_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null and new.status = 'active' then raise exception 'Deleted accounts cannot be reactivated'; end if;
  if old.deleted_at is not null then new.deleted_at := old.deleted_at; end if;
  return new;
end $$;
drop trigger if exists profiles_block_reactivate on public.profiles;
create trigger profiles_block_reactivate before update on public.profiles
  for each row execute function private.block_reactivate_deleted();
