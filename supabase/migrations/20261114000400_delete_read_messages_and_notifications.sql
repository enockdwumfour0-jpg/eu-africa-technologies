-- 022: names for the people in agent chats, and deleting messages / notifications you have already read.

-- ---------------------------------------------------------------- names in agent chats
-- Profiles are not readable by every role, so the people in agent chats come from here (names and position only).
create or replace function public.chat_parties()
returns table(thread_id uuid, agent_name text, staff_name text, staff_title text, client_name text, client_company text)
language sql stable security definer set search_path = '' as $$
  select th.id, ap.full_name, sp.full_name, sp.job_title, cp.full_name, c.company_name
  from public.message_threads th
  left join public.profiles ap on ap.id = th.agent_id
  left join public.profiles sp on sp.id = th.staff_id
  left join public.clients c on c.id = th.client_id
  left join public.profiles cp on cp.id = c.profile_id
  where th.agent_id is not null and private.can_access_thread(th.id)
$$;
revoke all on function public.chat_parties() from public, anon;
grant execute on function public.chat_parties() to authenticated;

-- ---------------------------------------------------------------- delete a message (for me only)
-- Deleting hides the message from your own view. The other people in the chat keep it, so nobody can erase
-- the record of a conversation for someone else. You can delete messages you sent, or messages you have read.
create table public.message_hides (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_hides enable row level security;
revoke all on public.message_hides from anon, authenticated;
grant select, insert on public.message_hides to authenticated;
create policy hides_select on public.message_hides for select to authenticated using (user_id = auth.uid());
create policy hides_insert on public.message_hides for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.messages m where m.id = message_id and (m.sender_id = auth.uid() or m.read_at is not null)));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated using (
  private.can_access_thread(thread_id)
  and not exists (select 1 from public.message_hides h where h.message_id = messages.id and h.user_id = auth.uid()));

-- ---------------------------------------------------------------- delete a notification you have read
grant delete on public.notifications to authenticated;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid() and read_at is not null);
