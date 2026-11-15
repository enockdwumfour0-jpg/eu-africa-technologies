import { supabase } from './supabase'

/** Calls the delete-account edge function. Omit userId to delete the signed-in user's own account. */
export async function deleteAccount(userId?: string) {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: userId ? { user_id: userId } : {} })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* keep default */ }
    throw new Error(msg)
  }
  return data as { ok: boolean; signed_out: boolean }
}
