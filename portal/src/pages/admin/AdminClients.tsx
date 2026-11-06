import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Pause, Play, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, Field, Modal, PageHeader, SearchBox, Select, Table, Tabs, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { date, dateTime, ghs } from '../../lib/format'
import MessagesView from '../../components/Messages'
import type { Client, Invoice, Payment, Project } from '../../lib/types'

type Row = Client & { profiles: { id: string; full_name: string; email: string; phone: string | null; status: string; rejection_reason: string | null; created_at: string } }

function useReview(reload: () => void) {
  const { run } = useAction(); const { confirm } = useFeedback()
  const [rejecting, setRejecting] = useState<Row | null>(null)
  return {
    rejecting, setRejecting,
    approve: async (r: Row) => { if (await confirm({ title: `Approve ${r.profiles.full_name}?`, text: 'They will be able to sign in and use the client portal.', action: 'Approve' })) { await run(async () => { ok(await supabase.rpc('review_client_application', { p_user: r.profile_id, p_decision: 'approved' })) }, 'Client approved'); reload() } },
    setStatus: async (r: Row, s: 'active' | 'suspended') => { if (await confirm({ title: `${s === 'active' ? 'Activate' : 'Suspend'} ${r.profiles.full_name}?`, text: s === 'suspended' ? 'They will lose access immediately.' : undefined, action: s === 'active' ? 'Activate' : 'Suspend', danger: s === 'suspended' })) { await run(async () => { ok(await supabase.rpc('set_account_status', { p_user: r.profile_id, p_status: s })) }, 'Account updated'); reload() } },
    reject: async (r: Row, note: string) => { const d = await run(async () => { ok(await supabase.rpc('review_client_application', { p_user: r.profile_id, p_decision: 'rejected', p_note: note || null })) }, 'Registration rejected'); if (d) { setRejecting(null); reload() } },
  }
}
function RejectModal({ r, onClose, onSubmit }: { r: Row; onClose: () => void; onSubmit: (n: string) => void }) {
  const [n, setN] = useState('')
  return <Modal title={`Reject ${r.profiles.full_name}`} onClose={onClose} small>
    <Field label="Reason (shown to the applicant)"><textarea className="input" rows={3} maxLength={500} value={n} onChange={(e) => setN(e.target.value)} /></Field>
    <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={() => onSubmit(n.trim())}>Reject</button></div></Modal>
}
const Actions = ({ r, rv }: { r: Row; rv: ReturnType<typeof useReview> }) => (
  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
    {(r.profiles.status === 'pending' || r.profiles.status === 'rejected') && <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => rv.approve(r)}><Check size={13} />Approve</button>}
    {r.profiles.status === 'pending' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => rv.setRejecting(r)}><X size={13} />Reject</button>}
    {r.profiles.status === 'active' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => rv.setStatus(r, 'suspended')}><Pause size={13} />Suspend</button>}
    {r.profiles.status === 'suspended' && <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => rv.setStatus(r, 'active')}><Play size={13} />Activate</button>}
  </div>
)

export default function AdminClients() {
  const nav = useNavigate()
  const q = useQuery(async () => ok(await supabase.from('clients').select('*, profiles!inner(id, full_name, email, phone, status, rejection_reason, created_at)').order('created_at', { ascending: false })) as unknown as Row[], [])
  const rv = useReview(q.reload)
  const [s, setS] = useState(''); const [st, setSt] = useState('all')
  return (
    <>
      <PageHeader title="Clients" sub="Review registrations and manage client accounts." />
      <div className="mb-3 flex flex-wrap gap-2"><SearchBox value={s} onChange={setS} placeholder="Search name, email, company" /><Select value={st} onChange={setSt} options={['pending', 'active', 'rejected', 'suspended']} all="All statuses" /></div>
      <Async q={q}>{(rows) => <Table rows={rows.filter((r) => (st === 'all' || r.profiles.status === st) && matches(s, r.profiles.full_name, r.profiles.email, r.company_name, r.profiles.phone))} onRow={(r) => nav(`/admin/clients/${r.id}`)} cols={[
        { header: 'Client', cell: (r) => <div><p className="font-semibold">{r.profiles.full_name || '—'}</p><p className="text-xs text-gray-500">{r.profiles.email}</p></div> },
        { header: 'Company', cell: (r) => r.company_name || '—' }, { header: 'Phone', cell: (r) => r.profiles.phone || '—' },
        { header: 'Registered', cell: (r) => date(r.profiles.created_at) }, { header: 'Status', cell: (r) => <Badge s={r.profiles.status} /> },
        { header: 'Actions', cell: (r) => <Actions r={r} rv={rv} /> },
      ]} />}</Async>
      {rv.rejecting && <RejectModal r={rv.rejecting} onClose={() => rv.setRejecting(null)} onSubmit={(n) => rv.reject(rv.rejecting!, n)} />}
    </>
  )
}

export function ClientDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState('overview')
  const q = useQuery(async () => {
    const [c, p, i, pay] = await Promise.all([
      supabase.from('clients').select('*, profiles!inner(id, full_name, email, phone, status, rejection_reason, created_at)').eq('id', id!).maybeSingle(),
      supabase.from('projects').select('*').eq('client_id', id!).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('client_id', id!).order('created_at', { ascending: false }),
      supabase.from('payments').select('*, invoices(number)').eq('client_id', id!).order('paid_at', { ascending: false }),
    ])
    return { c: ok(c) as unknown as Row | null, projects: ok(p) as Project[], inv: ok(i) as Invoice[], pay: ok(pay) as unknown as Payment[] }
  }, [id])
  const rv = useReview(q.reload)
  return (
    <>
      <Link to="/admin/clients" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-green"><ArrowLeft size={14} />All clients</Link>
      <Async q={q}>{({ c, projects, inv, pay }) => !c ? <p>Client not found.</p> : (
        <>
          <PageHeader title={c.profiles.full_name || c.profiles.email} sub={c.company_name ?? undefined} actions={<Actions r={c} rv={rv} />} />
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Profile' }, { id: 'projects', label: 'Projects', count: projects.length }, { id: 'payments', label: 'Payments', count: pay.length }, { id: 'messages', label: 'Messages' }]} />
          {tab === 'overview' && <div className="card grid gap-4 text-sm sm:grid-cols-2">
            {([['Email', c.profiles.email], ['Phone', c.profiles.phone || '—'], ['Company', c.company_name || '—'], ['Address', c.address || '—'], ['Registered', dateTime(c.profiles.created_at)]] as [string, string][]).map(([k, v]) => <div key={k}><p className="text-xs font-semibold uppercase text-gray-500">{k}</p><p>{v}</p></div>)}
            <div><p className="text-xs font-semibold uppercase text-gray-500">Status</p><Badge s={c.profiles.status} />{c.profiles.rejection_reason && <p className="mt-1 text-xs text-gray-600">Reason: {c.profiles.rejection_reason}</p>}</div></div>}
          {tab === 'projects' && <Table rows={projects} cols={[{ header: 'Project', cell: (p) => <Link className="font-semibold text-brand-green" to={`/admin/projects/${p.id}`}>{p.title}</Link> }, { header: 'Code', cell: (p) => p.code }, { header: 'Status', cell: (p) => <Badge s={p.status} /> }, { header: 'Progress', cell: (p) => p.progress + '%' }, { header: 'ETA', cell: (p) => date(p.estimated_completion) }]} />}
          {tab === 'payments' && <div className="space-y-4">
            <Table rows={inv} cols={[{ header: 'Invoice', cell: (i) => <b>{i.number}</b> }, { header: 'Total', cell: (i) => ghs(i.total) }, { header: 'Paid', cell: (i) => ghs(i.amount_paid) }, { header: 'Status', cell: (i) => <Badge s={i.status} /> }]} />
            <Table rows={pay} cols={[{ header: 'Receipt', cell: (p) => p.receipt_number }, { header: 'Date', cell: (p) => date(p.paid_at) }, { header: 'Amount', cell: (p) => ghs(p.amount) }, { header: 'Status', cell: (p) => <Badge s={p.status} /> }]} /></div>}
          {tab === 'messages' && <MessagesView mode="staff" onlyClientId={c.id} canStart={false} />}
        </>)}</Async>
      {rv.rejecting && <RejectModal r={rv.rejecting} onClose={() => rv.setRejecting(null)} onSubmit={(n) => rv.reject(rv.rejecting!, n)} />}
    </>
  )
}
