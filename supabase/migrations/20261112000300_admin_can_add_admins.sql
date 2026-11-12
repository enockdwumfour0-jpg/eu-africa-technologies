-- 019: administrators may also create and manage other administrators. Only the Super Administrator role stays reserved.
create or replace function private.can_manage_staff_role(target public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('super_admin')
      or (private.has_role('admin') and target in ('admin', 'project_manager', 'accountant', 'support_officer', 'agent'))
$$;
