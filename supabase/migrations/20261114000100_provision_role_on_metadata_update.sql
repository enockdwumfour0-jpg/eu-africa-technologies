-- GoTrue's admin createUser inserts the auth.users row first and writes app_metadata (provisioned_role) in a
-- second UPDATE about a second later. The signup trigger only runs on INSERT, so staff and agent accounts were
-- created as pending clients. This trigger applies the provisioned role when it arrives. app_metadata can only be
-- written with the service role, so a user cannot trigger it for themselves.
create or replace function private.apply_provisioned_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.app_role; cur public.app_role;
begin
  begin
    r := (new.raw_app_meta_data ->> 'provisioned_role')::public.app_role;
  exception when others then
    return new;
  end;
  if r is null or r = 'client' then return new; end if;

  select role into cur from public.user_roles where user_id = new.id;
  if cur is distinct from 'client' then return new; end if;   -- only convert an account that was defaulted to client

  update public.user_roles set role = r, assigned_by = null where user_id = new.id;
  delete from public.client_applications where user_id = new.id;
  delete from public.clients where profile_id = new.id;
  delete from public.notifications where user_id = new.id and type = 'registration_received';
  update public.profiles set status = 'active', approved_at = coalesce(approved_at, now()) where id = new.id;
  if r = 'agent' then
    insert into public.agents(user_id, code) values (new.id, private.new_agent_code()) on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_provisioned on auth.users;
create trigger on_auth_user_provisioned
  after update of raw_app_meta_data on auth.users
  for each row
  when (new.raw_app_meta_data ->> 'provisioned_role' is not null and new.raw_app_meta_data ->> 'provisioned_role' <> 'client')
  execute function private.apply_provisioned_role();
