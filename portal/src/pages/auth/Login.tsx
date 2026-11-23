import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { homeFor, isStaff, type Role } from '../../lib/roles'
import { useAuth } from '../../auth/AuthContext'
import AuthLayout from './AuthLayout'
import { Field } from '../../components/ui'
import { claimStoredReferral, signInWithGoogle } from '../../lib/google'

const NOTICE: Record<string, { tone: 'gold' | 'red' | 'green'; text: string }> = {
  pending: { tone: 'gold', text: 'Your account is waiting for approval by an administrator. We will email you as soon as it is approved.' },
  rejected: { tone: 'red', text: 'Your registration was not approved. Please contact info@eatl.co.com if you think this is a mistake.' },
  suspended: { tone: 'red', text: 'This account has been suspended. Please contact info@eatl.co.com.' },
  registered: { tone: 'green', text: 'Registration received. Verify your email, then wait for approval.' },
  reset: { tone: 'green', text: 'Password updated. You can sign in now.' },
}

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const { session, role, status, loading, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [notice, setNotice] = useState<string | null>(params.get('reason') || null)
  const fails = useRef({ n: 0, until: 0 })

  const target = (r: Role | null) => {
    const from = (loc.state as { from?: string } | null)?.from
    // only honour a return path that belongs to the user's own area
    if (from && ((r === 'client' && from.startsWith('/portal')) || (isStaff(r) && from.startsWith('/admin')))) return from
    return homeFor(r)
  }

  // Already signed in (or arrived from the email-verification link): route by role / explain status
  useEffect(() => {
    if (loading || !session) return
    if (status === 'active' && role) nav(target(role), { replace: true })
    else if (status && status !== 'active') { (status === 'pending' ? claimStoredReferral() : Promise.resolve()).finally(() => { setNotice(status); signOut() }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, role, status])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(''); setUnconfirmed(false)
    if (Date.now() < fails.current.until) { setErr('Too many attempts. Please wait a moment and try again.'); return }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      if (/not confirmed/i.test(error.message)) { setUnconfirmed(true); setErr('Please verify your email address first. Check your inbox for the link.') }
      else {
        fails.current.n++; if (fails.current.n >= 5) { fails.current = { n: 0, until: Date.now() + 30_000 } }
        setErr('Incorrect email or password.')
      }
    }
    // success: AuthContext picks up the session and the effect above redirects by role
  }
  async function resend() {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setErr(error ? 'Could not resend right now. Try again shortly.' : 'Verification email sent.')
  }
  const n = notice ? NOTICE[notice] : null
  return (
    <AuthLayout title="Sign in" sub="Client Portal and staff dashboard">
      {n && <div className={`mb-4 rounded-lg p-3 text-sm ${n.tone === 'gold' ? 'bg-yellow-50 text-yellow-900' : n.tone === 'red' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`} role="status">{n.text}</div>}
      <button type="button" onClick={async () => { setErr(''); const e = await signInWithGoogle(); if (e) setErr('Google sign-in is not available right now.') }} disabled={busy} className="btn-ghost flex w-full items-center justify-center gap-2 border border-gray-300"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.3 0 20 0 24s.9 7.7 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.500 42.600 14.600 48 24 48z"/></svg>Continue with Google</button>
<p className="my-3 text-center text-xs uppercase text-gray-400">or use your email</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email address"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password">
          <div className="relative">
            <input className="input !pr-10" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </Field>
        {err && <p className="text-sm text-red-600" role="alert">{err} {unconfirmed && <button type="button" onClick={resend} className="font-semibold underline">Resend email</button>}</p>}
        <button className="btn-primary w-full" disabled={busy || !email || !password}>{busy && <Loader2 size={16} className="animate-spin" />}Sign in</button>
      </form>
      <div className="mt-5 flex justify-between text-sm">
        <Link to="/forgot-password" className="font-semibold text-brand-green hover:underline">Forgot password?</Link>
        <Link to="/register" className="font-semibold text-brand-green hover:underline">Create client account</Link>
      </div>
    </AuthLayout>
  )
}
