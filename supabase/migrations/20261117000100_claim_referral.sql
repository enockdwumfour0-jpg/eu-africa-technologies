-- Google sign-up cannot carry a referral code in its metadata, so a brand-new client may claim one
-- right after signing in. Only a pending client with no agent, created in the last hour, and only an active agent's code.
create or replace function private.guard_client_agent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.agent_id is distinct from old.agent_id and not private.is_admin_or_above()
     and coalesce(current_setting('app.claim_referral', true), '') <> '1' then
    raise exception 'Not allowed to change the agent' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ac text := upper(left(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'), 12)); aid uuid; cid uuid; nm text;
begin
  if auth.uid() is null or ac = '' then return false; end if;
  select c.id into cid from public.clients c join public.profiles p on p.id = c.profile_id
   where c.profile_id = auth.uid() and c.agent_id is null and p.status = 'pending' and p.created_at > now() - interval '1 hour';
  if cid is null then return false; end if;
  select user_id into aid from public.agents where code = ac and status = 'active';
  if aid is null then return false; end if;
  perform set_config('app.claim_referral', '1', true);
  update public.clients set agent_id = aid where id = cid;
  perform set_config('app.claim_referral', '', true);
  update public.client_applications set agent_code = ac where user_id = auth.uid();
  select nullif(full_name, '') into nm from public.profiles where id = auth.uid();
  perform private.notify(aid, 'agent_referral', 'New client signed up with your code', coalesce(nm, 'A new client') || ' is waiting for approval.', '/agent/clients');
  return true;
end $$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;
