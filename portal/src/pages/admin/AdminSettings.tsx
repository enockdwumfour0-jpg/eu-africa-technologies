import { useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, Select, Table, Tabs, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { clean, dateTime, label, num } from '../../lib/format'
import { ROLE_LABEL, STAFF_ROLES, type Role } from '../../lib/roles'
import { useStaff, type StaffMember } from '../../lib/hooks'
import type { AuditLog } from '../../lib/types'

type Settings = { company: Record<string, string>; notifications: { email_enabled: boolean; types: Record<string, boolean> }; email: Record<string, string>; system: { currency: string; invoice_due_days: number; tax_rate_percent: number } }

export default function AdminSettings() {
  const { role } = useAuth()
  const sa = role === 'super_admin'
  const [tab, setTab] = useState('company')
  const q = useQuery(async () => {
    const rows = ok(await supabase.from('app_settings').select('key, value')) as { key: string; value: unknown }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as unknown as Settings
  }, [])
  const tabs = [{ id: 'company', label: 'Company' }, { id: 'notifications', label: 'Notifications' }, ...(sa ? [{ id: 'email', label: 'Email' }, { id: 'system', label: 'System' }] : []), { id: 'staff', label: 'Staff' }, ...(sa ? [{ id: 'paystack', label: 'Online payments' }] : []), { id: 'roles', label: 'Role permissions' }, { id: 'audit', label: 'Audit log' }]
  return (<><PageHeader title="Settings" sub="Company information, notifications, staff and system preferences." /><Tabs tabs={tabs} value={tab} onChange={setTab} />
    {tab === 'staff' ? <Staff /> : tab === 'paystack' && sa ? <PaystackSettings /> : tab === 'roles' ? <Roles /> : tab === 'audit' ? <Audit /> : <Async q={q}>{(s) => <SettingsForm tab={tab} s={s} reload={q.reload} />}</Async>}</>)
}

function SettingsForm({ tab, s, reload }: { tab: string; s: Settings; reload: () => void }) {
  const { session } = useAuth(); const { run, busy } = useAction()
  const [co, setCo] = useState(s.company); const [nt, setNt] = useState(s.notifications); const [em, setEm] = useState(s.email); const [sy, setSy] = useState(s.system)
  const save = (key: string, value: unknown) => (e: FormEvent) => { e.preventDefault(); run(async () => { ok(await supabase.from('app_settings').upsert({ key, value, updated_by: session!.user.id })); reload() }, 'Settings saved') }
  if (tab === 'company') return <form onSubmit={save('company', Object.fromEntries(Object.entries(co).map(([k, v]) => [k, clean(v)])))} className="card max-w-2xl space-y-4">
    {(['name', 'email', 'phone', 'address', 'website', 'tagline'] as const).map((k) => <Field key={k} label={label(k)}><input className="input" maxLength={200} value={co[k] ?? ''} onChange={(e) => setCo({ ...co, [k]: e.target.value })} /></Field>)}<button className="btn-primary" disabled={busy}>Save</button></form>
  if (tab === 'notifications') return <form onSubmit={save('notifications', nt)} className="card max-w-2xl space-y-3">
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={nt.email_enabled} onChange={(e) => setNt({ ...nt, email_enabled: e.target.checked })} />Send email notifications</label>
    <p className="text-xs text-gray-500">In-app notifications are always created. These switches control which events also send an email (users can opt out in their profile).</p>
    <div className="grid gap-2 sm:grid-cols-2">{Object.entries(nt.types).map(([k, v]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v} onChange={(e) => setNt({ ...nt, types: { ...nt.types, [k]: e.target.checked } })} />{label(k)}</label>)}</div><button className="btn-primary" disabled={busy}>Save</button></form>
  if (tab === 'email') return <form onSubmit={save('email', { from_name: clean(em.from_name ?? ''), reply_to: clean(em.reply_to ?? '') })} className="card max-w-2xl space-y-4">
    <Field label="Sender name"><input className="input" maxLength={80} value={em.from_name ?? ''} onChange={(e) => setEm({ ...em, from_name: e.target.value })} /></Field>
    <Field label="Reply-to address"><input className="input" type="email" maxLength={160} value={em.reply_to ?? ''} onChange={(e) => setEm({ ...em, reply_to: e.target.value })} /></Field>
    <p className="rounded-lg bg-brand-grey p-3 text-xs text-gray-600">Emails are sent through Resend from a server-side function. The API key and sending address are stored as secure server secrets (see the setup guide), never in the browser.</p><button className="btn-primary" disabled={busy}>Save</button></form>
  return <form onSubmit={save('system', { currency: 'GHS', invoice_due_days: Math.max(0, Math.min(365, Math.round(num(sy.invoice_due_days)))), tax_rate_percent: Math.max(0, Math.min(100, num(sy.tax_rate_percent))) })} className="card max-w-2xl space-y-4">
    <Field label="Currency"><input className="input" disabled value="GHS (Ghana cedi)" /></Field>
    <Field label="Default invoice due (days)"><input className="input" type="number" min={0} max={365} value={sy.invoice_due_days} onChange={(e) => setSy({ ...sy, invoice_due_days: num(e.target.value) })} /></Field>
    <Field label="Tax rate on invoices (%)" hint="Applied to new invoices. Set 0 for no tax."><input className="input" type="number" min={0} max={100} step="0.01" value={sy.tax_rate_percent} onChange={(e) => setSy({ ...sy, tax_rate_percent: num(e.target.value) })} /></Field><button className="btn-primary" disabled={busy}>Save</button></form>
}

function Staff() {
  const q = useStaff(); const { run } = useAction(); const { confirm } = useFeedback(); const [add, setAdd] = useState(false); const { session } = useAuth()
  const [editTitle, setEditTitle] = useState<StaffMember | null>(null)
  const { role: myRole } = useAuth(); const manage = (r: string) => myRole === 'super_admin' || ASSIGNABLE.includes(r as Role)
  const rpc = (fn: string, args: Record<string, unknown>, msg: string) => run(async () => { ok(await supabase.rpc(fn, args)) }, msg).then(() => q.reload())
  return (<>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="max-w-2xl text-xs text-gray-500"><b>Position</b> is the job title shown for the person (anything you like, for example HR Manager or Site Supervisor). <b>Access level</b> decides what they can do in the dashboard.</p>
      <button className="btn-primary" onClick={() => setAdd(true)}><Plus size={15} />Create staff account</button></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No staff accounts" />}>{(rows) => <Table rows={rows.map((r) => ({ ...r, id: r.id }))} cols={[
      { header: 'Name', cell: (r) => <div><p className="font-semibold">{r.full_name}</p><p className="text-xs text-gray-500">{r.email}</p></div> },
      { header: 'Position', cell: (r) => !manage(r.role) ? <span className="text-sm">{r.job_title || '—'}</span> : <button className="group flex items-center gap-1.5 text-left text-sm hover:text-brand-green" onClick={() => setEditTitle(r)} aria-label={`Edit position for ${r.full_name}`}>
        <span className={r.job_title ? '' : 'text-gray-400'}>{r.job_title || 'Add position'}</span><Pencil size={13} className="text-gray-400 group-hover:text-brand-green" /></button> },
      { header: 'Access level', cell: (r) => r.id === session!.user.id || !manage(r.role) ? <span>{ROLE_LABEL[r.role as Role]} {r.id === session!.user.id && <span className="text-xs text-gray-500">(you)</span>}</span> :
        <select className="input !w-auto !py-1 text-xs" value={r.role} onChange={async (e) => { if (await confirm({ title: `Change role to ${ROLE_LABEL[e.target.value as Role]}?`, text: r.full_name, action: 'Change role' })) rpc('set_user_role', { p_user: r.id, p_role: e.target.value }, 'Role updated') }}>{(myRole === 'super_admin' ? STAFF_ROLES : ASSIGNABLE).map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select> },
      { header: 'Status', cell: (r) => <Badge s={r.status} /> },
      { header: '', cell: (r) => r.id !== session!.user.id && manage(r.role) && (r.status === 'active'
        ? <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => { if (await confirm({ title: `Suspend ${r.full_name}?`, text: 'They lose access immediately.', action: 'Suspend', danger: true })) rpc('set_account_status', { p_user: r.id, p_status: 'suspended' }, 'Account suspended') }}>Suspend</button>
        : <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => rpc('set_account_status', { p_user: r.id, p_status: 'active' }, 'Account activated')}>Activate</button>) },
    ]} />}</Async>
    {add && <NewStaff onClose={() => setAdd(false)} onDone={() => { setAdd(false); q.reload() }} />}
    {editTitle && <EditTitle s={editTitle} onClose={() => setEditTitle(null)} onDone={() => { setEditTitle(null); q.reload() }} />}
  </>)
}

// Common positions offered as suggestions; any other text can be typed.
const POSITIONS = ['Operations Manager', 'HR Manager', 'Marketing Officer', 'Sales Executive', 'Site Supervisor', 'Site Engineer', 'Procurement Officer', 'Customer Service Officer', 'Receptionist', 'Logistics Officer']
function PositionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (<Field label="Position (job title)" hint="Type any position. It is only a label and does not change what the person can access.">
    <input className="input" list="staff-positions" maxLength={80} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. HR Manager" />
    <datalist id="staff-positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist></Field>)
}
function EditTitle({ s, onClose, onDone }: { s: StaffMember; onClose: () => void; onDone: () => void }) {
  const [t, setT] = useState(s.job_title ?? ''); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault(); const d = await run(async () => { ok(await supabase.rpc('set_staff_title', { p_user: s.id, p_title: clean(t) })) }, 'Position saved'); if (d) onDone() }
  return <Modal title={`Position for ${s.full_name}`} onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <PositionField value={t} onChange={setT} />
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div></form></Modal>
}
function NewStaff({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { role: myRole } = useAuth()
  const [f, setF] = useState({ full_name: '', email: '', role: 'project_manager', job_title: '' }); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault()
    const d = await run(async () => { const { data, error } = await supabase.functions.invoke('admin-create-staff', { body: { full_name: clean(f.full_name), email: f.email.trim(), role: f.role, job_title: clean(f.job_title) } })
      if (error) { let m = error.message; try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) m = j.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error) }, 'Staff account created. A password-setup email was sent.'); if (d) onDone() }
  return <Modal title="Create staff account" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Full name"><input className="input" required maxLength={120} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
    <Field label="Email"><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
    <PositionField value={f.job_title} onChange={(v) => setF({ ...f, job_title: v })} />
    <Field label="Access level" hint="What they can do in the dashboard. See the Role permissions tab."><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{(myRole === 'super_admin' ? STAFF_ROLES : ASSIGNABLE).map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</select></Field>
    <p className="text-xs text-gray-500">The new staff member receives an email to set their own password. The access level is assigned on the server and cannot be changed by the user.</p>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Create</button></div></form></Modal>
}

// Roles an Administrator may create and manage (administrator access itself is Super Administrator only).
const ASSIGNABLE: Role[] = ['project_manager', 'accountant', 'support_officer']
const AREAS = ['Clients & approvals', 'Projects & milestones', 'Project requests', 'Documents', 'Messages', 'Invoices & payments', 'Reports', 'Settings & staff', 'Website content']
const MATRIX: Record<string, string[]> = {
  super_admin: ['Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'All', 'Full', 'Full'],
  admin: ['Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'All', 'Company, notifications, staff (not admins)', 'Enquiries only'],
  project_manager: ['—', 'Assigned only', '—', 'Assigned projects', 'Assigned projects', '—', 'Projects', '—', '—'],
  accountant: ['View', 'View', '—', '—', '—', 'Full', 'Finance', '—', '—'],
  support_officer: ['View', 'View', 'View + notes', 'View', 'Reply', '—', 'Operations', '—', '—'],
  client: ['Own account', 'Own projects', 'Submit & view own', 'Own documents', 'Own conversations', 'Own records (read)', '—', '—', '—'],
}
function Roles() {
  return (<div className="space-y-3"><p className="text-sm text-gray-600">Permissions are enforced by the database (Row Level Security), not just by what the menus show. Administrators can create and manage project managers, accountants and support officers; only a Super Administrator can manage administrators, the website, online payments and the system and email settings.</p>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[44rem] text-left text-xs"><thead className="bg-brand-grey uppercase text-gray-500"><tr><th className="px-3 py-2">Area</th>{Object.keys(MATRIX).map((r) => <th key={r} className="px-3 py-2">{ROLE_LABEL[r as Role]}</th>)}</tr></thead>
      <tbody className="divide-y">{AREAS.map((a, i) => <tr key={a}><td className="px-3 py-2 font-semibold">{a}</td>{Object.values(MATRIX).map((v, j) => <td key={j} className={`px-3 py-2 ${v[i] === '—' ? 'text-gray-300' : ''}`}>{v[i]}</td>)}</tr>)}</tbody></table></div></div>)
}

function Audit() {
  const { role } = useAuth(); const [tbl, setTbl] = useState('all')
  const q = useQuery(async () => {
    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200)
    if (tbl !== 'all') query = query.eq('table_name', tbl)
    const rows = ok(await query) as AuditLog[]
    const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[]
    const names = ids.length ? (ok(await supabase.from('profiles').select('id, full_name, email').in('id', ids)) as { id: string; full_name: string; email: string }[]) : []
    return rows.map((r) => ({ ...r, actor: names.find((n) => n.id === r.actor_id)?.full_name || names.find((n) => n.id === r.actor_id)?.email || (r.actor_id ? 'User' : 'System') }))
  }, [tbl])
  if (role !== 'super_admin' && role !== 'admin') return <EmptyState title="Audit log is available to administrators" />
  return (<><div className="mb-3"><Select value={tbl} onChange={setTbl} all="All tables" options={['invoices', 'payments', 'ledger_entries', 'documents', 'document_reviews', 'projects', 'user_roles', 'profiles', 'client_applications', 'app_settings']} /></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No audit entries" />}>{(rows) => <Table rows={rows} cols={[{ header: 'When', cell: (r) => dateTime(r.created_at) }, { header: 'Who', cell: (r) => r.actor }, { header: 'Action', cell: (r) => r.action }, { header: 'Table', cell: (r) => r.table_name }, { header: 'Record', cell: (r) => <span className="font-mono text-xs">{r.record_id?.slice(0, 8)}</span> }]} />}</Async></>)
}

type PsCfg = { enabled: boolean; subaccount_code: string | null; commission_percent: number; fee_bearer: 'account' | 'subaccount' }
const WEBHOOK = 'https://enlkrucktzppkyxrljpr.supabase.co/functions/v1/paystack-webhook'
function PaystackSettings() {
  const q = useQuery(async () => ok(await supabase.from('paystack_config').select('enabled, subaccount_code, commission_percent, fee_bearer').maybeSingle()) as PsCfg, [])
  return (<Async q={q}>{(c) => <PaystackForm c={c} reload={q.reload} />}</Async>)
}
function PaystackForm({ c, reload }: { c: PsCfg; reload: () => void }) {
  const [f, setF] = useState({ enabled: c.enabled, sub: c.subaccount_code ?? '', pct: String(c.commission_percent), bearer: c.fee_bearer }); const { run, busy } = useAction()
  const save = async (e: FormEvent) => { e.preventDefault(); const r = await run(async () => {
    const pct = Number(f.pct); if (!(pct >= 0 && pct <= 30)) throw new Error('Commission must be between 0 and 30%')
    const sub = f.sub.trim(); if (sub && !/^ACCT_[A-Za-z0-9]{6,40}$/.test(sub)) throw new Error('Subaccount code looks like ACCT_xxxxxxxxxx')
    if (f.enabled && pct > 0 && !sub) throw new Error('A commission needs the subaccount code')
    ok(await supabase.from('paystack_config').update({ enabled: f.enabled, subaccount_code: sub || null, commission_percent: pct, fee_bearer: f.bearer }).eq('id', true)) }, 'Online payment settings saved'); if (r) reload() }
  return (<form onSubmit={save} className="card max-w-2xl space-y-4 p-5">
    <p className="text-sm text-gray-600">Lets clients pay invoices by card or mobile money through Paystack. It is off until you switch it on here <b>and</b> the Paystack secret key has been added to the server (see the setup guide). Payments are recorded automatically once Paystack confirms them.</p>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Allow clients to pay online</label>
    <Field label="Commission (% of each payment)"><input className="input" type="number" min="0" max="30" step="0.01" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>
    <Field label="EU-AFRIC Paystack subaccount code"><input className="input" placeholder="ACCT_xxxxxxxxxx" value={f.sub} onChange={(e) => setF({ ...f, sub: e.target.value })} /></Field>
    <Field label="Who pays Paystack's fee"><select className="input" value={f.bearer} onChange={(e) => setF({ ...f, bearer: e.target.value as PsCfg['fee_bearer'] })}><option value="subaccount">EU-AFRIC (commission is paid in full)</option><option value="account">Crestonic (fee comes out of the commission)</option></select></Field>
    <p className="text-xs text-gray-500">The commission is taken from what is paid, so the client always pays exactly the invoice amount. It is split by Paystack: the commission goes to the Crestonic Solutions Paystack account (the account whose key is installed) and the rest to the EU-AFRIC subaccount.</p>
    <p className="text-xs text-gray-500">Webhook URL to enter in Paystack (Settings, API Keys and Webhooks): <code className="break-all">{WEBHOOK}</code></p>
    <div className="flex justify-end"><button className="btn-primary" disabled={busy}>Save settings</button></div></form>)
}
