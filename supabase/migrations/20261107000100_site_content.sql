-- 011: editable website text. The public pages carry default text in their HTML; rows here override it.
-- Anyone may read (the public site needs it); only Administrators and Super Administrators may change it.
create table public.site_content (
  id uuid not null default gen_random_uuid(),
  key text primary key check (key ~ '^[a-z0-9-]+\.[a-z0-9]+\.[0-9]+$'),
  page text not null check (page ~ '^[a-z0-9-]+$'),
  value text not null check (char_length(value) between 1 and 2000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create index site_content_page_idx on public.site_content(page);
alter table public.site_content enable row level security;
revoke all on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;
create policy site_content_read on public.site_content for select to anon, authenticated using (true);
create policy site_content_ins on public.site_content for insert to authenticated with check (private.is_admin_or_above());
create policy site_content_upd on public.site_content for update to authenticated using (private.is_admin_or_above()) with check (private.is_admin_or_above());
create policy site_content_del on public.site_content for delete to authenticated using (private.is_admin_or_above());
create or replace function private.site_content_stamp() returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_by := auth.uid(); new.updated_at := now(); return new; end $$;
create trigger site_content_stamp before insert or update on public.site_content for each row execute function private.site_content_stamp();
create trigger audit_site_content after insert or update or delete on public.site_content for each row execute function private.audit();
