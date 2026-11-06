import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import AuthLayout from './AuthLayout'
import { Field } from '../../components/ui'

export default function Forgot() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/reset-password' })
    setBusy(false); setSent(true) // never reveal whether the address has an account
  }
  return (
    <AuthLayout title="Reset your password" sub="We'll email you a link to choose a new one.">
      {sent ? (
        <div className="text-sm text-gray-700"><p>If an account exists for <b>{email}</b>, a reset link is on its way. The link expires after a short time.</p><Link to="/login" className="btn-primary mt-6 w-full">Back to sign in</Link></div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email address"><input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={busy || !email}>{busy && <Loader2 size={16} className="animate-spin" />}Send reset link</button>
          <p className="text-center text-sm"><Link to="/login" className="font-semibold text-brand-green hover:underline">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  )
}
