import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clean } from '../../lib/format'
import AuthLayout from './AuthLayout'
import { Field } from '../../components/ui'
import { passwordIssue, strength } from './password'

export default function Register() {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', company: '', address: '', notes: '', password: '', confirm: '', website: '' })
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
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
    const { error } = await supabase.auth.signUp({
      email: f.email.trim(), password: f.password,
      options: {
        emailRedirectTo: window.location.origin + '/login',
        data: { full_name: name, phone, company: clean(f.company), address: clean(f.address), notes: clean(f.notes) },
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
