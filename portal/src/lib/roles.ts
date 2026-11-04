export type Role =
  | 'super_admin' | 'admin' | 'project_manager' | 'accountant' | 'support_officer' | 'client'

export const STAFF_ROLES: Role[] = ['super_admin', 'admin', 'project_manager', 'accountant', 'support_officer']
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Administrator', admin: 'Administrator', project_manager: 'Project Manager',
  accountant: 'Accountant', support_officer: 'Support Officer', client: 'Client',
}

export const isStaff = (r: Role | null) => !!r && STAFF_ROLES.includes(r)

// Where each role lands after login. Display only: access is enforced by RLS.
// Project managers go straight to their assigned-projects interface.
export const homeFor = (r: Role | null) =>
  r === 'client' ? '/portal' : r === 'project_manager' ? '/admin/projects' : isStaff(r) ? '/admin' : '/login'
