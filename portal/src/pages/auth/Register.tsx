import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clean } from '../../lib/format'
import { signInWithGoogle } from '../../lib/google'
import AuthLayout from './AuthLayout'
import { Field } from '../../components/ui'
import { PWNED_MESSAGE, isPwned, passwordIssue, strength } from './password'

export default function Register() {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', company: '', address: '', notes: '', password: '', confirm: '', website: '', code: '' })
  const [params] = useSearchParams()
  const tidy = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase()
  const linkRef = tidy(params.get('ref') ?? '')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const ref = linkRef || tidy(f.code) // the link wins; otherwise the code typed by the client
  const s = strength(f.password)

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (f.website) { setDone(true); return } // honeypot: bots fill hidden fields
    const name = clean(f.full_name), phone = clean(f.phone)
    if (name.length < 2) return setErr('Please enter your full name.')
    if (!/^[+\d][\d\s()-]{6,}$/.test(phone)) return setErr('Enter a valid phone number.')
    const pw = passwordIssue(f.password); if (pw) return setErr(pw)
    if (f.password !== f.confirm) return setErr('Passwords do not match.')
    if (!agree) return setErr('Please accept the privacy policy and terms.')
    setBusy(true)
    if (await isPwned(f.password)) { setBusy(false); return setErr(PWNED_MESSAGE) }
    const { error } = await supabase.auth.signUp({
      email: f.email.trim(), password: f.password,
      options: {
        emailRedirectTo: window.location.origin + '/login',
        data: { full_name: name, phone, company: clean(f.company), address: clean(f.address), notes: clean(f.notes), ...(ref ? { agent_code: ref } : {}) },
      },
    })
    setBusy(false)
    // Same message whether or not the email already exists (no account enumeration)
    if (error && !/already|registered/i.test(error.message)) return setErr(error.message.includes('rate') ? 'Too many attempts. Please try again later.' : 'We could not create your account. Please check your details and try again.')
    setDone(true)
  }

  if (done) return (
    <AuthLayout title="Check your email">
      <div className="text-center">
        <CheckCircle2 className="mx-auto text-brand-green" size={44} />
        <p className="mt-4 text-sm text-gray-700">We sent a verification link to <b>{f.email}</b>. Open it to confirm your email address.</p>
        <p className="mt-3 text-sm text-gray-700">After that, an EU-AFRIC administrator will review and approve your account. You will receive an email once it is approved.</p>
        <Link to="/login" className="btn-primary mt-6 w-full">Back to sign in</Link>
      </div>
    </AuthLayout>
  )
  return (
    <AuthLayout title="Create a client account" sub="New accounts are reviewed by our team before access is granted.">
      <button type="button" onClick={async () => { setErr(''); if (!agree) return setErr('Please accept the privacy policy and terms first.'); const e = await signInWithGoogle(ref); if (e) setErr('Google sign-in is not available right now.') }} disabled={busy} className="btn-ghost flex w-full items-center justify-center gap-2 border border-gray-300"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.3 0 20 0 24s.9 7.7 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.500 42.600 14.600 48 24 48z"/></svg>Continue with Google</button>
<p className="my-3 text-center text-xs uppercase text-gray-400">or use your email</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name *"><input className="input" autoComplete="name" required maxLength={120} value={f.full_name} onChange={set('full_name')} /></Field>
          <Field label="Phone *"><input className="input" type="tel" autoComplete="tel" required maxLength={40} value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <Field label="Email address *"><input className="input" type="email" autoComplete="email" required maxLength={160} value={f.email} onChange={set('email')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company (optional)"><input className="input" autoComplete="organization" maxLength={160} value={f.company} onChange={set('company')} /></Field>
          <Field label="Address (optional)"><input className="input" autoComplete="street-address" maxLength={300} value={f.address} onChange={set('address')} /></Field>
        </div>
        <Field label="Agent referral code (optional)" hint={linkRef ? 'Applied from your referral link.' : 'If an agent gave you a code, enter it here.'}><input className="input uppercase" maxLength={12} autoComplete="off" readOnly={!!linkRef} value={linkRef || f.code} onChange={set('code')} /></Field>
        <Field label="What do you need from us? (optional)"><textarea className="input" rows={2} maxLength={1000} value={f.notes} onChange={set('notes')} /></Field>
        <Field label="Password *" hint="At least 10 characters, with letters and numbers.">
          <input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} />
          <div className="mt-1.5 flex gap-1" aria-hidden="true">{[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 flex-1 rounded ${i <= s ? (s < 3 ? 'bg-brand-yellow' : 'bg-brand-green') : 'bg-gray-200'}`} />)}</div>
        </Field>
        <Field label="Confirm password *"><input className="input" type="password" autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} /></Field>
        <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to the <a className="font-semibold text-brand-green underline" href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a> and <a className="font-semibold text-brand-green underline" href="/terms.html" target="_blank" rel="noopener">Terms &amp; Conditions</a>.</span>
        </label>
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />}Create account</button>
      </form>
      <p className="mt-5 text-center text-sm text-gray-600">Already registered? <Link to="/login" className="font-semibold text-brand-green hover:underline">Sign in</Link></p>
    </AuthLayout>
  )
}
