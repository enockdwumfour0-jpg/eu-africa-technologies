import { supabase } from './supabase'

const KEY = 'eatl_ref'
/** Starts Google sign-in. An optional agent referral code is remembered and claimed after the user returns. */
export async function signInWithGoogle(refCode?: string) {
  try { if (refCode) localStorage.setItem(KEY, refCode); else localStorage.removeItem(KEY) } catch { /* storage blocked */ }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/login' } })
  return error
}
/** Applies (and forgets) the remembered referral code for a brand-new account. Safe to call any time. */
export async function claimStoredReferral() {
  let code: string | null = null
  try { code = localStorage.getItem(KEY); localStorage.removeItem(KEY) } catch { /* ignore */ }
  if (code) await supabase.rpc('claim_referral', { p_code: code })
}
