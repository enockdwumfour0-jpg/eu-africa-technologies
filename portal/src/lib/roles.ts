export type Role =
  | 'super_admin' | 'admin' | 'project_manager' | 'accountant' | 'support_officer' | 'client'

export const STAFF_ROLES: Role[] = ['super_admin', 'admin', 'project_manager', 'accountant', 'support_officer']

export const isStaff = (r: Role | null) => !!r && STAFF_ROLES.includes(r)

// Where each role lands after login. Display only: access is enforced by RLS.
export const homeFor = (r: Role | null) => (r === 'client' ? '/portal' : isStaff(r) ? '/admin' : '/login')
