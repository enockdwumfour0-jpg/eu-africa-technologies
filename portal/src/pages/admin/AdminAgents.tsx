import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, SearchBox, StatCard, Table, Tabs, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { clean, date, ghs, label, num } from '../../lib/format'
import { exportCsv, type Col } from '../../lib/export'

const TYPES = [['real_estate_agent', 'Real estate agent'], ['broker', 'Broker'], ['agent', 'Sales agent'], ['other', 'Other']]
const typeLabel = (t: string) => TYPES.find((x) => x[0] === t)?.[1] ?? t
type AgentRow = { user_id: string; code: string; agent_type: string; agency: string | null; default_rate: number; status: string; payout_details: string | null; notes: string | null; created_at: string; profiles: { full_name: string; email: string; phone: string | null } | null }
type Entry = { id: string; agent_id: string; created_at: string; invoice_number: string | null; receipt_number: string | null; product: string | null; base_amount: number; rate: number; amount: number; status: string }
type Payout = { id: string; agent_id: string; amount: number; method: string; reference: string | null; paid_at: string; note: string | null }
const balance = (agent: string, e: Entry[], p: Payout[]) => {
  const earned = e.filter((x) => x.agent_id === agent && x.status === 'accrued').reduce((s, x) => s + Number(x.amount), 0)
  const paid = p.filter((x) => x.agent_id === agent).reduce((s, x) => s + Number(x.amount), 0)
  return { earned, paid, owed: Math.round((earned - paid) * 100) / 100 }
}
const useCanEdit = () => { const { role } = useAuth(); return role === 'super_admin' || role === 'admin' }

export default function AdminAgents() {
  const nav = useNavigate(); const canEdit = useCanEdit(); const [s, setS] = useState(''); const [add, setAdd] = useState(false)
  const q = useQuery(async () => {
    const [a, e, p, c] = await Promise.all([supabase.from('agents').select('*, profiles(full_name, email, phone)').order('created_at', { ascending: false }),
      supabase.from('commission_entries').select('*'), supabase.from('commission_payouts').select('*'), supabase.from('clients').select('id, agent_id').not('agent_id', 'is', null)])
    return { a: ok(a) as unknown as AgentRow[], e: ok(e) as Entry[], p: ok(p) as Payout[], c: ok(c) as { id: string; agent_id: string }[] } }, [])
  return (<>
    <PageHeader title="Agents" sub="Agents and brokers, their commission rates and what they are owed." actions={canEdit && <button className="btn-primary" onClick={() => setAdd(true)}><Plus size={16} />New agent</button>} />
    <div className="mb-3"><SearchBox value={s} onChange={setS} placeholder="Search agents" /></div>
    <Async q={q} empty={(d) => d.a.length === 0 && <EmptyState title="No agents yet" text="Create an agent account. They get an email to set their password and a referral link." />}>{({ a, e, p, c }) => <Table rows={a.map((x) => ({ ...x, id: x.user_id })).filter((x) => matches(s, x.profiles?.full_name, x.profiles?.email, x.agency, x.code))} onRow={(x) => nav(`/admin/agents/${x.user_id}`)} cols={[
      { header: 'Agent', cell: (x) => <div><p className="font-semibold">{x.profiles?.full_name || '—'}</p><p className="text-xs text-gray-500">{typeLabel(x.agent_type)}{x.agency ? ` · ${x.agency}` : ''}</p></div> },
      { header: 'Code', cell: (x) => x.code }, { header: 'Clients', cell: (x) => c.filter((k) => k.agent_id === x.user_id).length }, { header: 'Rate', cell: (x) => x.default_rate + '%' },
      { header: 'Earned', cell: (x) => ghs(balance(x.user_id, e, p).earned) }, { header: 'Owed', cell: (x) => <b>{ghs(balance(x.user_id, e, p).owed)}</b> }, { header: 'Status', cell: (x) => <Badge s={x.status} /> }]} />}</Async>
    {add && <NewAgent onClose={() => setAdd(false)} onDone={() => { setAdd(false); q.reload() }} />}
  </>)
}

function NewAgent({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', agency: '', agent_type: 'real_estate_agent', default_rate: '5' }); const { run, busy } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => { e.preventDefault()
    const d = await run(async () => { const { data, error } = await supabase.functions.invoke('admin-create-agent', { body: { ...f, full_name: clean(f.full_name), email: f.email.trim(), phone: clean(f.phone), agency: clean(f.agency), default_rate: num(f.default_rate) } })
      if (error) { let m = error.message; try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) m = j.error } catch { /* ignore */ } throw new Error(m) }
      if (data?.error) throw new Error(data.error) }, 'Agent account created. A password-setup email was sent.'); if (d) onDone() }
  return <Modal title="Create agent account" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Full name"><input className="input" required maxLength={120} value={f.full_name} onChange={set('full_name')} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Email"><input className="input" type="email" required value={f.email} onChange={set('email')} /></Field><Field label="Phone"><input className="input" maxLength={40} value={f.phone} onChange={set('phone')} /></Field></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Type"><select className="input" value={f.agent_type} onChange={set('agent_type')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Field label="Agency / company"><input className="input" maxLength={160} value={f.agency} onChange={set('agency')} /></Field></div>
    <Field label="Standard commission rate (%)" hint="Applies to every payment unless a product rate is set later."><input className="input" type="number" min="0" max="100" step="0.01" required value={f.default_rate} onChange={set('default_rate')} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Create</button></div></form></Modal>
}

export function AgentDetail() {
  const { id } = useParams(); const canEdit = useCanEdit(); const [tab, setTab] = useState('statement'); const { run } = useAction(); const { confirm, toast } = useFeedback()
  const [pay, setPay] = useState(false); const [edit, setEdit] = useState(false)
  const q = useQuery(async () => {
    const [a, r, e, p, c] = await Promise.all([supabase.from('agents').select('*, profiles(full_name, email, phone)').eq('user_id', id!).maybeSingle(), supabase.from('agent_rates').select('*').eq('agent_id', id!).order('product'),
      supabase.from('commission_entries').select('*').eq('agent_id', id!).order('created_at', { ascending: false }), supabase.from('commission_payouts').select('*').eq('agent_id', id!).order('paid_at', { ascending: false }),
      supabase.from('clients').select('id, company_name, profiles(full_name, status)').eq('agent_id', id!)])
    return { a: ok(a) as unknown as AgentRow | null, r: ok(r) as { id: string; product: string; rate: number }[], e: ok(e) as Entry[], p: ok(p) as Payout[], c: ok(c) as unknown as { id: string; company_name: string | null; profiles: { full_name: string; status: string } | null }[] } }, [id])
  const upd = async (patch: Record<string, unknown>, msg: string) => { await run(async () => { ok(await supabase.from('agents').update(patch).eq('user_id', id!)) }, msg); q.reload() }
  return (<>
    <Link to="/admin/agents" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-green"><ArrowLeft size={14} />All agents</Link>
    <Async q={q}>{({ a, r, e, p, c }) => { if (!a) return <p>Agent not found.</p>; const b = balance(a.user_id, e, p)
      const eCols: Col<Entry>[] = [{ header: 'Date', get: (x) => date(x.created_at) }, { header: 'Invoice', get: (x) => x.invoice_number ?? '' }, { header: 'Receipt', get: (x) => x.receipt_number ?? '' }, { header: 'Product', get: (x) => x.product ?? '' }, { header: 'Payment', get: (x) => x.base_amount }, { header: 'Rate %', get: (x) => x.rate }, { header: 'Commission', get: (x) => x.amount }, { header: 'Status', get: (x) => label(x.status) }]
      return (<>
        <PageHeader title={a.profiles?.full_name || 'Agent'} sub={`${typeLabel(a.agent_type)}${a.agency ? ' · ' + a.agency : ''} · code ${a.code}`} actions={<div className="flex gap-2">
          {canEdit && <button className="btn-ghost" onClick={() => setEdit(true)}>Edit</button>}
          {canEdit && (a.status === 'active' ? <button className="btn-ghost" onClick={async () => { if (await confirm({ title: 'Suspend this agent?', text: 'They lose dashboard access. Commission already earned is kept.', action: 'Suspend', danger: true })) upd({ status: 'suspended' }, 'Agent suspended') }}>Suspend</button> : <button className="btn-primary" onClick={() => upd({ status: 'active' }, 'Agent activated')}>Activate</button>)}
          <button className="btn-primary" disabled={b.owed <= 0} onClick={() => setPay(true)}>Record payout</button></div>} />
        <div className="mb-4 grid gap-3 sm:grid-cols-4"><StatCard label="Earned" value={ghs(b.earned)} tone="grey" /><StatCard label="Paid" value={ghs(b.paid)} /><StatCard label="Owed" value={ghs(b.owed)} tone="gold" /><StatCard label="Standard rate" value={a.default_rate + '%'} tone="grey" /></div>
        <p className="mb-3 text-sm text-gray-600">{a.profiles?.email}{a.profiles?.phone ? ` · ${a.profiles.phone}` : ''} · <Badge s={a.status} /> · Payout details: {a.payout_details || 'not provided yet'}</p>
        <button className="btn-ghost mb-3 !py-1 text-xs" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/register?ref=${a.code}`).then(() => toast('Referral link copied'), () => toast('Could not copy', 'err'))}><Copy size={13} />Copy referral link</button>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'statement', label: 'Statement', count: e.length }, { id: 'payouts', label: 'Payouts', count: p.length }, { id: 'rates', label: 'Product rates', count: r.length }, { id: 'clients', label: 'Clients', count: c.length }]} />
        {tab === 'statement' && <><div className="mb-2 flex justify-end"><button className="btn-ghost" onClick={() => exportCsv('statement-' + a.code, eCols, e)}>CSV</button></div><Table rows={e} cols={[{ header: 'Date', cell: (x) => date(x.created_at) }, { header: 'Invoice', cell: (x) => x.invoice_number ?? '—' }, { header: 'Product', cell: (x) => x.product ?? '—' }, { header: 'Payment', cell: (x) => ghs(x.base_amount) }, { header: 'Rate', cell: (x) => x.rate + '%' }, { header: 'Commission', cell: (x) => ghs(x.amount) }, { header: 'Status', cell: (x) => <Badge s={x.status} /> }]} /></>}
        {tab === 'payouts' && <Table rows={p} cols={[{ header: 'Date', cell: (x) => date(x.paid_at) }, { header: 'Amount', cell: (x) => <b>{ghs(x.amount)}</b> }, { header: 'Method', cell: (x) => label(x.method) }, { header: 'Reference', cell: (x) => x.reference ?? '—' }, { header: 'Note', cell: (x) => x.note ?? '—' }]} />}
        {tab === 'rates' && <Rates agent={a.user_id} rows={r} canEdit={canEdit} reload={q.reload} />}
        {tab === 'clients' && <Table rows={c} cols={[{ header: 'Client', cell: (x) => <Link className="font-semibold text-brand-green" to={`/admin/clients/${x.id}`}>{x.profiles?.full_name || '—'}</Link> }, { header: 'Company', cell: (x) => x.company_name ?? '—' }, { header: 'Status', cell: (x) => x.profiles && <Badge s={x.profiles.status} /> }]} />}
        {pay && <PayoutForm agent={a.user_id} owed={b.owed} onClose={() => setPay(false)} onDone={() => { setPay(false); q.reload() }} />}
        {edit && <EditAgent a={a} onClose={() => setEdit(false)} onDone={() => { setEdit(false); q.reload() }} />}</>) }}</Async></>)
}

function Rates({ agent, rows, canEdit, reload }: { agent: string; rows: { id: string; product: string; rate: number }[]; canEdit: boolean; reload: () => void }) {
  const [product, setProduct] = useState(''); const [rate, setRate] = useState(''); const { run, busy } = useAction()
  return (<div className="space-y-3"><p className="text-sm text-gray-600">A product rate replaces the standard rate when the invoice's product matches (not case sensitive).</p>
    <Table rows={rows} empty={<EmptyState title="No product rates" text="The standard rate applies to everything." />} cols={[{ header: 'Product', cell: (x) => x.product }, { header: 'Rate', cell: (x) => x.rate + '%' }, { header: '', cell: (x) => canEdit && <button className="btn-ghost !p-1.5 text-red-600" onClick={async () => { await run(async () => { ok(await supabase.from('agent_rates').delete().eq('id', x.id)) }, 'Rate removed'); reload() }}><Trash2 size={15} /></button> }]} />
    {canEdit && <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); const d = await run(async () => { const { error } = await supabase.from('agent_rates').insert({ agent_id: agent, product: clean(product), rate: num(rate) }); if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'That product already has a rate' : error.message) }, 'Rate added'); if (d) { setProduct(''); setRate(''); reload() } }}>
      <Field label="Product / service"><input className="input" required maxLength={80} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Solar installation" /></Field>
      <Field label="Rate (%)"><input className="input w-28" type="number" required min="0" max="100" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
      <button className="btn-primary" disabled={busy}><Plus size={15} />Add</button></form>}</div>)
}

function PayoutForm({ agent, owed, onClose, onDone }: { agent: string; owed: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(owed)); const [method, setMethod] = useState('mobile_money'); const [ref, setRef] = useState(''); const [paid, setPaid] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(''); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault(); const d = await run(async () => { ok(await supabase.rpc('record_commission_payout', { p_agent: agent, p_amount: num(amount), p_method: method, p_reference: clean(ref) || null, p_paid_at: paid, p_note: clean(note) || null })) }, 'Payout recorded'); if (d) onDone() }
  return <Modal title="Record commission payout" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <p className="text-sm text-gray-600">Owed to this agent: <b>{ghs(owed)}</b>. This records a payment you have already made; no money is moved by the portal.</p>
    <Field label="Amount (GHS)"><input className="input" type="number" required min="0.01" max={owed} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{['mobile_money', 'bank_transfer', 'cash', 'cheque', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field><Field label="Date paid"><input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={paid} onChange={(e) => setPaid(e.target.value)} /></Field></div>
    <Field label="Reference"><input className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
    <Field label="Note"><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Record payout</button></div></form></Modal>
}

function EditAgent({ a, onClose, onDone }: { a: AgentRow; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ agent_type: a.agent_type, agency: a.agency ?? '', default_rate: String(a.default_rate), notes: a.notes ?? '' }); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault(); const d = await run(async () => { ok(await supabase.from('agents').update({ agent_type: f.agent_type, agency: clean(f.agency) || null, default_rate: num(f.default_rate), notes: clean(f.notes) || null }).eq('user_id', a.user_id)) }, 'Agent updated'); if (d) onDone() }
  return <Modal title="Edit agent" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Type"><select className="input" value={f.agent_type} onChange={(e) => setF({ ...f, agent_type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    <Field label="Agency / company"><input className="input" maxLength={160} value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })} /></Field>
    <Field label="Standard commission rate (%)" hint="Changes apply to future payments only; past commission keeps the rate it was earned at."><input className="input" type="number" min="0" max="100" step="0.01" required value={f.default_rate} onChange={(e) => setF({ ...f, default_rate: e.target.value })} /></Field>
    <Field label="Internal notes"><textarea className="input" rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div></form></Modal>
}
