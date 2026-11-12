import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import AuthLayout from './AuthLayout'
import { Field } from '../../components/ui'
import { PWNED_MESSAGE, isPwned, passwordIssue } from './password'

export default function Reset() {
  const nav = useNavigate()
  const [ready, setReady] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // The recovery link signs the user in with a short-lived recovery session
    const { data } = supabase.auth.onAuthStateChange((e) => { if (e === 'PASSWORD_RECOVERY') setReady(true) })
    supabase.auth.getSession().then(({ data: s }) => { if (s.session) setReady(true) })
    return () => data.subscription.unsubscribe()
  }, [])
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    const issue = passwordIssue(pw); if (issue) return setErr(issue)
    if (pw !== pw2) return setErr('Passwords do not match.')
    setBusy(true)
    if (await isPwned(pw)) { setBusy(false); return setErr(PWNED_MESSAGE) }
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) { setBusy(false); return setErr(error.message) }
    await supabase.auth.signOut()
    nav('/login?reason=reset', { replace: true })
  }
  return (
    <AuthLayout title="Choose a new password">
      {!ready ? (
        <div className="text-sm text-gray-700"><p>This reset link is invalid or has expired.</p><Link to="/forgot-password" className="btn-primary mt-5 w-full">Request a new link</Link></div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 10 characters, with letters and numbers."><input className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />}Update password</button>
        </form>
      )}
    </AuthLayout>
  )
}
