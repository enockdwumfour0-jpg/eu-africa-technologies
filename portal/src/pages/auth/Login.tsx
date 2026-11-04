import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { homeFor, isStaff, type Role } from '../../lib/roles'
import { useAuth } from '../../auth/AuthContext'
import AuthLayout from './AuthLayout'
import { Field } from '../../components/ui'

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
    else if (status && status !== 'active') { setNotice(status); signOut() }
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
