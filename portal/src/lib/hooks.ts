import { supabase } from './supabase'
import { ok, useQuery } from '../components/ui'
import type { Client } from './types'

// The signed-in client's own record (RLS returns only their row, and only while active)
export function useMyClient() {
  return useQuery(async () => ok(await supabase.from('clients').select('*').limit(1).maybeSingle()) as Client | null, [])
}

export type StaffMember = { id: string; full_name: string; email: string; role: string; status: string; job_title: string | null }
// All staff accounts (non-client). Staff may read these rows under RLS.
export function useStaff() {
  return useQuery(async () => {
    const roles = ok(await supabase.from('user_roles').select('user_id, role').neq('role', 'client')) as { user_id: string; role: string }[]
    if (!roles.length) return [] as StaffMember[]
    const ps = ok(await supabase.from('profiles').select('id, full_name, email, status, job_title').in('id', roles.map((r) => r.user_id))) as { id: string; full_name: string; email: string; status: string; job_title: string | null }[]
    return roles.map((r) => { const p = ps.find((x) => x.id === r.user_id); return { id: r.user_id, role: r.role, full_name: p?.full_name || p?.email || 'Staff', email: p?.email ?? '', status: p?.status ?? '', job_title: p?.job_title ?? null } }) as StaffMember[]
  }, [])
}
