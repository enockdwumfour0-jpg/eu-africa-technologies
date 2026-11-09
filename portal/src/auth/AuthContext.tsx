import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Role } from '../lib/roles'

export type AccountStatus = 'pending' | 'active' | 'rejected' | 'suspended'

type AuthState = {
  loading: boolean
  session: Session | null
  role: Role | null
  status: AccountStatus | null
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [status, setStatus] = useState<AccountStatus | null>(null)

  // Role and status come from the database (RLS lets a user read only their own rows).
  async function load(s: Session | null) {
    setSession(s)
    if (!s) { setRole(null); setStatus(null); setLoading(false); return }
    const [r, p] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', s.user.id).maybeSingle(),
      supabase.from('profiles').select('status').eq('id', s.user.id).maybeSingle(),
    ])
    setRole((r.data?.role as Role) ?? null)
    setStatus((p.data?.status as AccountStatus) ?? null)
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { load(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    loading, session, role, status,
    signOut: async () => { await supabase.auth.signOut() },
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session) },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
