import { useEffect, useState, type FormEvent } from 'react'
import { Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, Field, PageHeader, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { checkFile, signedUrl } from '../../lib/files'
import { clean, initials } from '../../lib/format'
import { useAuth } from '../../auth/AuthContext'
import { passwordIssue } from '../auth/password'
import type { Client, Profile } from '../../lib/types'

export default function ClientProfile() {
  const { session } = useAuth()
  const uid = session!.user.id
  const q = useQuery(async () => {
    const [p, c] = await Promise.all([supabase.from('profiles').select('*').eq('id', uid).maybeSingle(), supabase.from('clients').select('*').maybeSingle()])
    return { p: ok(p) as Profile, c: ok(c) as Client | null }
  }, [uid])
  return (<><PageHeader title="My profile" sub="Manage your contact details, password and notifications." /><Async q={q}>{({ p, c }) => <Forms p={p} c={c} reload={q.reload} />}</Async></>)
}

function Forms({ p, c, reload }: { p: Profile; c: Client | null; reload: () => void }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const { run, busy } = useAction(); const { toast } = useFeedback()
  const [f, setF] = useState({ full_name: p.full_name, phone: p.phone ?? '', company: p.company ?? '', address: c?.address ?? '' })
  const [prefs, setPrefs] = useState(p.notification_prefs)
  const [pw, setPw] = useState({ a: '', b: '' })
  const [avatar, setAvatar] = useState<string | null>(null)
  useEffect(() => { if (p.avatar_path) signedUrl('avatars', p.avatar_path).then(setAvatar).catch(() => {}) }, [p.avatar_path])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const a = await supabase.from('profiles').update({ full_name: clean(f.full_name), phone: clean(f.phone) || null, company: clean(f.company) || null }).eq('id', uid)
    if (a.error) throw a.error
    if (c) { const b = await supabase.from('clients').update({ address: clean(f.address) || null, company_name: clean(f.company) || null }).eq('id', c.id); if (b.error) throw b.error }
    reload()
  }, 'Profile saved') }
  const savePrefs = () => run(async () => { const r = await supabase.from('profiles').update({ notification_prefs: prefs }).eq('id', uid); if (r.error) throw r.error }, 'Preferences saved')
  const changePw = (e: FormEvent) => { e.preventDefault(); const i = passwordIssue(pw.a); if (i) return toast(i, 'err'); if (pw.a !== pw.b) return toast('Passwords do not match', 'err')
    run(async () => { const r = await supabase.auth.updateUser({ password: pw.a }); if (r.error) throw r.error; setPw({ a: '', b: '' }) }, 'Password changed') }
  const pickAvatar = (file?: File) => { if (!file) return; const bad = checkFile(file, { images: true, maxMB: 2 }); if (bad) return toast(bad, 'err')
    run(async () => {
      const path = `${uid}/avatar-${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
      const up = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type }); if (up.error) throw up.error
      const r = await supabase.from('profiles').update({ avatar_path: path }).eq('id', uid); if (r.error) throw r.error
      if (p.avatar_path) await supabase.storage.from('avatars').remove([p.avatar_path])
      reload()
    }, 'Profile picture updated') }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={save} className="card space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative">{avatar ? <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover" /> : <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-green text-2xl font-bold text-white">{initials(p.full_name || p.email)}</span>}
            <label className="absolute -bottom-1 -right-1 cursor-pointer rounded-full bg-brand-yellow p-1.5 shadow" title="Change picture"><Camera size={14} /><input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => pickAvatar(e.target.files?.[0])} /></label></div>
          <div><p className="font-semibold">{p.email}</p><p className="text-sm text-gray-500">Account <Badge s={p.status} /></p></div>
        </div>
        <Field label="Full name"><input className="input" required maxLength={120} value={f.full_name} onChange={set('full_name')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Phone"><input className="input" maxLength={40} value={f.phone} onChange={set('phone')} /></Field><Field label="Company"><input className="input" maxLength={160} value={f.company} onChange={set('company')} /></Field></div>
        <Field label="Address"><input className="input" maxLength={300} value={f.address} onChange={set('address')} /></Field>
        <p className="text-xs text-gray-500">To change your email address or account details, contact EU-AFRIC.</p>
        <button className="btn-primary" disabled={busy}>Save changes</button>
      </form>
      <div className="space-y-5">
        <section className="card space-y-3"><h2 className="font-semibold">Notification preferences</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} />Email me about project updates, messages, documents and invoices</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.in_app} onChange={(e) => setPrefs({ ...prefs, in_app: e.target.checked })} />Show in-app notifications</label>
          <button className="btn-ghost" onClick={savePrefs} disabled={busy}>Save preferences</button></section>
        <form onSubmit={changePw} className="card space-y-3"><h2 className="font-semibold">Change password</h2>
          <Field label="New password" hint="At least 10 characters, with letters and numbers."><input className="input" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></Field>
          <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
          <button className="btn-ghost" disabled={busy || !pw.a}>Update password</button></form>
      </div>
    </div>
  )
}
