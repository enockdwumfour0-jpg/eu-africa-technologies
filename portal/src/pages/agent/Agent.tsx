import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import MessagesView from '../../components/Messages'
import { ArrowLeft, Copy, Download, FolderKanban, MessageCircle, Plus, Trash2, Upload, Users, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, Progress, SearchBox, StatCard, Table, Tabs, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { ACCEPT, checkFile, openFile, upload } from '../../lib/files'
import { bytes, clean, date, ghs, label } from '../../lib/format'
import { exportCsv, type Col } from '../../lib/export'
import type { Doc, Project } from '../../lib/types'

type Overview = { clients: number; active_clients: number; active_projects: number; leads_open: number; earned: number; paid: number; pending: number; month_earned: number; month_collected: number; target: number | null; bonus_now: number; next_min: number | null; next_bonus: number | null }
type CRow = { client_id: string; name: string; company: string | null; phone: string | null; account_status: string; joined: string; projects: number; active_projects: number; invoiced: number; paid: number; outstanding: number; commission: number }
type Entry = { bonus_rate?: number; id: string; created_at: string; invoice_number: string | null; receipt_number: string | null; product: string | null; base_amount: number; rate: number; amount: number; status: string; client_id: string | null }
type Payout = { id: string; amount: number; method: string; reference: string | null; paid_at: string; note: string | null }
type Lead = { id: string; name: string; phone: string | null; email: string | null; interest: string | null; status: string; notes: string | null; created_at: string }
type MyAgent = { code: string; agency: string | null; default_rate: number; payout_details: string | null; agent_type: string }

const refLink = (code: string) => `${window.location.origin}/register?ref=${code}`
const useClients = () => useQuery(async () => ok(await supabase.rpc('agent_client_overview')) as CRow[], [])
const useMe = () => { const { session } = useAuth(); return useQuery(async () => ok(await supabase.from('agents').select('*').eq('user_id', session!.user.id).maybeSingle()) as MyAgent | null, [session?.user.id]) }

export function AgentOverview() {
  const o = useQuery(async () => ok(await supabase.rpc('agent_overview')) as Overview, [])
  const c = useClients(); const me = useMe()
  return (<>
    <PageHeader title="Agent dashboard" sub="Your clients, their projects and your commission." />
    <Async q={o}>{(d) => (<div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="My clients" value={d.clients} icon={<Users size={20} />} hint={`${d.active_clients} approved`} />
      <StatCard label="Active projects" value={d.active_projects} icon={<FolderKanban size={20} />} tone="grey" />
      <StatCard label="Commission pending" value={ghs(d.pending)} icon={<Wallet size={20} />} tone="gold" hint={`${ghs(d.month_earned)} earned this month`} />
      <StatCard label="Commission paid" value={ghs(d.paid)} icon={<Wallet size={20} />} hint={`${ghs(d.earned)} earned in total`} />
    </div>)}</Async>
    <Async q={o}>{(d) => <Goals d={d} />}</Async>
    {me.data && <div className="card mb-5"><p className="text-sm font-semibold">Your referral link</p><p className="mt-1 break-all text-sm text-gray-600">{refLink(me.data.code)}</p><ShareButtons code={me.data.code} /></div>}
    <h2 className="mb-2 font-semibold">Recent clients</h2>
    <Async q={c} empty={(d) => d.length === 0 && <EmptyState title="No clients yet" text="Share your referral link. Clients who register with it appear here." />}>{(rows) => <ClientTable rows={rows.slice(0, 5)} />}</Async>
  </>)
}

function Goals({ d }: { d: Overview }) {
  if (!d.target && !d.next_min && !d.bonus_now) return null
  const pct = (v: number, of: number) => Math.min(100, Math.round((v / of) * 100))
  return <div className="card mb-5 space-y-4">
    <div className="flex items-baseline justify-between"><h2 className="font-semibold">This month</h2><span className="text-sm text-gray-600">Collected from your clients: <b>{ghs(d.month_collected)}</b></span></div>
    {d.target ? <div><div className="mb-1 flex justify-between text-sm"><span>Monthly target</span><span>{ghs(d.month_collected)} of {ghs(d.target)}</span></div><Progress value={pct(d.month_collected, d.target)} /></div> : null}
    {d.next_min ? <div><div className="mb-1 flex justify-between text-sm"><span>Next bonus tier: +{d.next_bonus} points on your rate</span><span>{ghs(d.month_collected)} of {ghs(d.next_min)}</span></div><Progress value={pct(d.month_collected, d.next_min)} /></div> : null}
    {d.bonus_now > 0 && <p className="text-sm font-semibold text-brand-green">You currently earn a bonus of +{d.bonus_now} points on every payment this month.</p>}
  </div>
}

function ShareButtons({ code }: { code: string }) {
  const { toast } = useFeedback(); const link = refLink(code)
  return <div className="mt-3 flex flex-wrap gap-2">
    <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(link).then(() => toast('Link copied'), () => toast('Could not copy', 'err'))}><Copy size={15} />Copy link</button>
    <a className="btn-ghost" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent('Register with EU-AFRIC Technologies: ' + link)}`}><MessageCircle size={15} />Share on WhatsApp</a></div>
}

function ClientTable({ rows }: { rows: CRow[] }) {
  const nav = useNavigate()
  return <Table rows={rows.map((r) => ({ ...r, id: r.client_id }))} onRow={(r) => nav(`/agent/clients/${r.client_id}`)} cols={[
    { header: 'Client', cell: (r) => <div><p className="font-semibold">{r.name || '—'}</p><p className="text-xs text-gray-500">{r.company || r.phone || ''}</p></div> },
    { header: 'Status', cell: (r) => <Badge s={r.account_status} /> },
    { header: 'Projects', cell: (r) => `${r.active_projects} active / ${r.projects}` },
    { header: 'Invoiced', cell: (r) => ghs(r.invoiced) }, { header: 'Paid', cell: (r) => ghs(r.paid) },
    { header: 'Outstanding', cell: (r) => ghs(r.outstanding) }, { header: 'My commission', cell: (r) => ghs(r.commission) }]} />
}

export function AgentClients() {
  const q = useClients(); const [s, setS] = useState('')
  return (<><PageHeader title="My clients" sub="Clients who registered with your link or were assigned to you." />
    <div className="mb-3"><SearchBox value={s} onChange={setS} placeholder="Search clients" /></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No clients yet" text="Share your referral link from the Profile page." />}>{(rows) => <ClientTable rows={rows.filter((r) => matches(s, r.name, r.company, r.phone))} />}</Async></>)
}

export function AgentClientDetail() {
  const { id } = useParams(); const [tab, setTab] = useState('projects'); const [up, setUp] = useState(false)
  const q = useQuery(async () => {
    const [c, p, d] = await Promise.all([supabase.rpc('agent_client_overview'), supabase.from('projects').select('*').eq('client_id', id!).eq('archived', false).order('created_at', { ascending: false }),
      supabase.from('documents').select('*').eq('client_id', id!).order('created_at', { ascending: false })])
    return { c: (ok(c) as CRow[]).find((x) => x.client_id === id) ?? null, projects: ok(p) as Project[], docs: ok(d) as Doc[] }
  }, [id])
  return (<>
    <Link to="/agent/clients" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-green"><ArrowLeft size={14} />All clients</Link>
    <Async q={q}>{({ c, projects, docs }) => !c ? <p>Client not found.</p> : (<>
      <PageHeader title={c.name || 'Client'} sub={c.company ?? undefined} actions={<button className="btn-primary" onClick={() => setUp(true)}><Upload size={16} />Upload file</button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Invoiced" value={ghs(c.invoiced)} tone="grey" /><StatCard label="Paid" value={ghs(c.paid)} /><StatCard label="Outstanding" value={ghs(c.outstanding)} tone="red" /><StatCard label="My commission" value={ghs(c.commission)} tone="gold" /></div>
      <p className="mb-3 text-sm text-gray-600">Account: <Badge s={c.account_status} />{c.phone && <> · Phone: {c.phone}</>} · Joined {date(c.joined)}</p>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'projects', label: 'Projects', count: projects.length }, { id: 'files', label: 'Files I uploaded', count: docs.length }]} />
      {tab === 'projects' && (projects.length === 0 ? <EmptyState title="No projects yet" text="Projects appear here once the office creates them." /> : <ProjectCards rows={projects as unknown as PRow[]} />)}
      {tab === 'files' && <FileTable rows={docs} onChange={q.reload} />}
      {up && <UploadForm clients={[c]} onClose={() => setUp(false)} onDone={() => { setUp(false); q.reload() }} />}</>)}</Async>
  </>)
}

type PRow = Omit<Project, 'clients'> & { clients?: { company_name: string | null; profiles: { full_name: string } | null } | null }
function ProjectCards({ rows }: { rows: PRow[] }) {
  return <div className="grid gap-4 md:grid-cols-2">{rows.map((p) => (
    <Link key={p.id} to={`/agent/projects/${p.id}`} className="card block transition hover:border-brand-green hover:shadow-md">
      <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-gray-500">{p.code}{p.clients ? ` · ${p.clients.profiles?.full_name ?? p.clients.company_name ?? ''}` : ''}</p><h3 className="font-display text-lg font-semibold">{p.title}</h3></div><Badge s={p.status} /></div>
      <div className="mt-3"><Progress value={p.progress} /></div>
      <p className="mt-2 text-xs text-gray-500">Estimated completion: {date(p.estimated_completion)}</p></Link>))}</div>
}

export function AgentProjects() {
  const q = useQuery(async () => ok(await supabase.from('projects').select('*, clients(company_name, profiles(full_name))').eq('archived', false).order('created_at', { ascending: false })) as unknown as PRow[], [])
  return (<><PageHeader title="Projects" sub="Follow the progress of your clients' projects." />
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No projects yet" text="Projects for your clients appear here." />}>{(rows) => <ProjectCards rows={rows} />}</Async></>)
}

function FileTable({ rows, onChange }: { rows: Doc[]; onChange: () => void }) {
  const { confirm, toast } = useFeedback(); const { run } = useAction()
  return <Table rows={rows} empty={<EmptyState title="No files yet" text="Files you upload for your clients appear here." />} cols={[
    { header: 'File', cell: (d) => <div><p className="font-semibold">{d.title}</p><p className="text-xs text-gray-500">{d.file_name} · {bytes(d.size_bytes)}</p></div> },
    { header: 'Date', cell: (d) => date(d.created_at) }, { header: 'Status', cell: (d) => <Badge s={d.status} /> },
    { header: '', cell: (d) => <div className="flex gap-1"><button className="btn-ghost !p-1.5" title="Open" onClick={() => openFile('documents', d.storage_path, d.file_name).catch(() => toast('Could not open the file', 'err'))}><Download size={15} /></button>
      {d.status === 'pending' && <button className="btn-ghost !p-1.5 text-red-600" title="Delete" onClick={async () => { if (await confirm({ title: 'Delete this file?', action: 'Delete', danger: true })) { await run(async () => { ok(await supabase.from('documents').delete().eq('id', d.id)) }, 'File deleted'); onChange() } }}><Trash2 size={15} /></button>}</div> }]} />
}

function UploadForm({ clients, onClose, onDone }: { clients: { client_id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [client, setClient] = useState(clients.length === 1 ? clients[0]!.client_id : ''); const [title, setTitle] = useState(''); const [cat, setCat] = useState('Site documents'); const [proj, setProj] = useState(''); const [file, setFile] = useState<File | null>(null)
  const projects = useQuery(async () => client ? ok(await supabase.from('projects').select('id, title').eq('client_id', client).eq('archived', false)) as { id: string; title: string }[] : [], [client])
  const { run, busy } = useAction(); const { toast } = useFeedback()
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!file || !client) return
    const bad = checkFile(file); if (bad) return toast(bad, 'err')
    const done = await run(async () => {
      const path = await upload('documents', client, file)
      const { error } = await supabase.from('documents').insert({ title: clean(title), category: cat, client_id: client, project_id: proj || null, direction: 'from_client', storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size })
      if (error) { await supabase.storage.from('documents').remove([path]); throw error }
    }, 'File uploaded. The EU-AFRIC team will review it.'); if (done) onDone() }
  return <Modal title="Upload a file for a client" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <Field label="Client"><select className="input" required value={client} onChange={(e) => { setClient(e.target.value); setProj('') }}><option value="">Select client…</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}</select></Field>
    <Field label="Title"><input className="input" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{['Site documents', 'Identification', 'Contract', 'Site photos', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Project (optional)"><select className="input" value={proj} onChange={(e) => setProj(e.target.value)}><option value="">Not linked to a project</option>{(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field></div>
    <Field label="File" hint="PDF, DOCX, XLSX, JPG or PNG, up to 20 MB."><input className="input" type="file" required accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !file || !client}>Upload</button></div></form></Modal>
}

export function AgentFiles() {
  const q = useQuery(async () => ok(await supabase.from('documents').select('*').order('created_at', { ascending: false })) as Doc[], [])
  const c = useClients(); const [up, setUp] = useState(false)
  return (<><PageHeader title="Files" sub="Files you uploaded for your clients. The office reviews each one." actions={<button className="btn-primary" disabled={!c.data?.length} onClick={() => setUp(true)}><Upload size={16} />Upload file</button>} />
    <Async q={q}>{(rows) => <FileTable rows={rows} onChange={q.reload} />}</Async>
    {up && c.data && <UploadForm clients={c.data} onClose={() => setUp(false)} onDone={() => { setUp(false); q.reload() }} />}</>)
}

const LEAD_STATUS = ['new', 'contacted', 'interested', 'converted', 'lost']
export function AgentLeads() {
  const q = useQuery(async () => ok(await supabase.from('agent_leads').select('*').order('created_at', { ascending: false })) as Lead[], [])
  const [add, setAdd] = useState(false); const { run } = useAction(); const { confirm } = useFeedback(); const me = useMe()
  const setStatus = async (l: Lead, status: string) => { await run(async () => { ok(await supabase.from('agent_leads').update({ status }).eq('id', l.id)) }); q.reload() }
  return (<><PageHeader title="Leads" sub="Keep track of people you are talking to." actions={<button className="btn-primary" onClick={() => setAdd(true)}><Plus size={16} />Add lead</button>} />
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No leads yet" text="Add prospects here and follow up on them." />}>{(rows) => <Table rows={rows} cols={[
      { header: 'Lead', cell: (l) => <div><p className="font-semibold">{l.name}</p><p className="text-xs text-gray-500">{[l.phone, l.email].filter(Boolean).join(' · ')}</p></div> },
      { header: 'Interested in', cell: (l) => l.interest || '—' }, { header: 'Added', cell: (l) => date(l.created_at) },
      { header: 'Status', cell: (l) => <select className="input !py-1 text-xs" value={l.status} onChange={(e) => setStatus(l, e.target.value)}>{LEAD_STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select> },
      { header: '', cell: (l) => <div className="flex gap-1">
        {l.phone && me.data && <a className="btn-ghost !p-1.5" title="Send registration link on WhatsApp" target="_blank" rel="noopener" href={`https://wa.me/${l.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${l.name}, you can register with EU-AFRIC Technologies here: ${refLink(me.data.code)}`)}`}><MessageCircle size={15} /></a>}
        <button className="btn-ghost !p-1.5 text-red-600" title="Delete" onClick={async () => { if (await confirm({ title: `Delete ${l.name}?`, action: 'Delete', danger: true })) { await run(async () => { ok(await supabase.from('agent_leads').delete().eq('id', l.id)) }, 'Lead deleted'); q.reload() } }}><Trash2 size={15} /></button></div> }]} />}</Async>
    {add && <LeadForm onClose={() => setAdd(false)} onDone={() => { setAdd(false); q.reload() }} />}</>)
}
function LeadForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session } = useAuth(); const [f, setF] = useState({ name: '', phone: '', email: '', interest: '', notes: '' }); const { run, busy } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => { e.preventDefault()
    const d = await run(async () => { const { error } = await supabase.from('agent_leads').insert({ agent_id: session!.user.id, name: clean(f.name), phone: clean(f.phone) || null, email: clean(f.email) || null, interest: clean(f.interest) || null, notes: clean(f.notes) || null }); if (error) throw error }, 'Lead added'); if (d) onDone() }
  return <Modal title="Add a lead" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Name"><input className="input" required maxLength={120} value={f.name} onChange={set('name')} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Phone"><input className="input" maxLength={40} value={f.phone} onChange={set('phone')} /></Field><Field label="Email"><input className="input" type="email" maxLength={254} value={f.email} onChange={set('email')} /></Field></div>
    <Field label="Interested in"><input className="input" maxLength={160} value={f.interest} onChange={set('interest')} placeholder="e.g. Solar installation" /></Field>
    <Field label="Notes"><textarea className="input" rows={2} maxLength={1000} value={f.notes} onChange={set('notes')} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Add</button></div></form></Modal>
}

export function AgentCommission() {
  const [tab, setTab] = useState('earnings')
  const o = useQuery(async () => ok(await supabase.rpc('agent_overview')) as Overview, [])
  const q = useQuery(async () => {
    const [e, p] = await Promise.all([supabase.from('commission_entries').select('*').order('created_at', { ascending: false }), supabase.from('commission_payouts').select('*').order('paid_at', { ascending: false })])
    return { e: ok(e) as Entry[], p: ok(p) as Payout[] } }, [])
  const eCols: Col<Entry>[] = [{ header: 'Date', get: (r) => date(r.created_at) }, { header: 'Invoice', get: (r) => r.invoice_number ?? '' }, { header: 'Receipt', get: (r) => r.receipt_number ?? '' }, { header: 'Product', get: (r) => r.product ?? '' }, { header: 'Payment (GHS)', get: (r) => r.base_amount }, { header: 'Rate %', get: (r) => r.rate }, { header: 'Commission (GHS)', get: (r) => r.amount }, { header: 'Status', get: (r) => label(r.status) }]
  return (<><PageHeader title="Commission" sub="Commission is earned each time a client you referred pays." />
    <Async q={o}>{(d) => <div className="mb-4 grid gap-3 sm:grid-cols-3"><StatCard label="Earned" value={ghs(d.earned)} tone="grey" /><StatCard label="Paid to you" value={ghs(d.paid)} /><StatCard label="Pending payout" value={ghs(d.pending)} tone="gold" /></div>}</Async>
    <Async q={q}>{({ e, p }) => (<>
      <div className="mb-3 flex items-center justify-between gap-2"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'earnings', label: 'Earnings', count: e.length }, { id: 'payouts', label: 'Payouts', count: p.length }]} />
        <button className="btn-ghost" onClick={() => exportCsv('commission', eCols, e)}>CSV</button></div>
      {tab === 'earnings' ? <Table rows={e} empty={<EmptyState title="No commission yet" text="It appears here when a referred client makes a payment." />} cols={[
        { header: 'Date', cell: (r) => date(r.created_at) }, { header: 'Invoice', cell: (r) => r.invoice_number ?? '—' }, { header: 'Product', cell: (r) => r.product ?? '—' },
        { header: 'Payment', cell: (r) => ghs(r.base_amount) }, { header: 'Rate', cell: (r) => r.rate + '%' + (r.bonus_rate ? ` (+${r.bonus_rate} bonus)` : '') }, { header: 'Commission', cell: (r) => <b>{ghs(r.amount)}</b> }, { header: 'Status', cell: (r) => <Badge s={r.status} /> }]} />
        : <Table rows={p} empty={<EmptyState title="No payouts yet" />} cols={[{ header: 'Date', cell: (r) => date(r.paid_at) }, { header: 'Amount', cell: (r) => <b>{ghs(r.amount)}</b> }, { header: 'Method', cell: (r) => label(r.method) }, { header: 'Reference', cell: (r) => r.reference ?? '—' }, { header: 'Note', cell: (r) => r.note ?? '—' }]} />}</>)}</Async></>)
}

export function AgentProfile() {
  const me = useMe(); const rates = useQuery(async () => ok(await supabase.from('agent_rates').select('id, product, rate').order('product')) as { id: string; product: string; rate: number }[], [])
  const [f, setF] = useState<{ agency: string; payout: string } | null>(null); const { run, busy } = useAction()
  return (<><PageHeader title="My profile" sub="Your referral link, payout details and commission rates." />
    <Async q={me}>{(a) => !a ? <p>Agent record not found.</p> : (() => { const v = f ?? { agency: a.agency ?? '', payout: a.payout_details ?? '' }; return (<div className="grid gap-5 lg:grid-cols-2">
      <section className="card"><h2 className="font-semibold">Referral link</h2><p className="mt-1 text-sm text-gray-600">Code <b>{a.code}</b>. Clients who register through this link are linked to you after the office approves them.</p><p className="mt-2 break-all rounded bg-gray-50 p-2 text-sm">{refLink(a.code)}</p><ShareButtons code={a.code} /></section>
      <section className="card"><h2 className="mb-3 font-semibold">Commission rates</h2><p className="text-sm">Standard rate: <b>{a.default_rate}%</b></p>
        <ul className="mt-2 space-y-1 text-sm">{(rates.data ?? []).map((r) => <li key={r.id} className="flex justify-between border-b py-1"><span>{r.product}</span><b>{r.rate}%</b></li>)}</ul><p className="mt-2 text-xs text-gray-500">Rates are set by the EU-AFRIC office.</p></section>
      <section className="card lg:col-span-2"><h2 className="mb-3 font-semibold">Details</h2><form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); await run(async () => { ok(await supabase.rpc('update_my_agent_details', { p_agency: clean(v.agency), p_payout_details: clean(v.payout) })) }, 'Details saved'); me.reload() }}>
        <Field label="Agency / company"><input className="input" maxLength={160} value={v.agency} onChange={(e) => setF({ ...v, agency: e.target.value })} /></Field>
        <Field label="Payout details" hint="Mobile money number or bank account the office should pay commission to."><textarea className="input" rows={2} maxLength={500} value={v.payout} onChange={(e) => setF({ ...v, payout: e.target.value })} /></Field>
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={busy}>Save</button></div></form></section></div>) })()}</Async></>)
}

export function AgentMessages() {
  return (<><PageHeader title="Messages" sub="Chat with the EU-AFRIC office." /><MessagesView mode="agent" /></>)
}

type Res = { id: string; title: string; description: string | null; category: string | null; storage_path: string; file_name: string; size_bytes: number; created_at: string }
export function AgentResources() {
  const q = useQuery(async () => ok(await supabase.from('agent_resources').select('*').eq('published', true).order('created_at', { ascending: false })) as Res[], [])
  const [s, setS] = useState(''); const { toast } = useFeedback()
  return (<><PageHeader title="Resources" sub="Brochures, price lists and other material from EU-AFRIC to help you sell." />
    <div className="mb-3"><SearchBox value={s} onChange={setS} placeholder="Search resources" /></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No resources yet" text="The office will add brochures and price lists here." />}>{(rows) => <Table rows={rows.filter((r) => matches(s, r.title, r.category, r.description))} cols={[
      { header: 'Resource', cell: (r) => <div><p className="font-semibold">{r.title}</p>{r.description && <p className="text-xs text-gray-500">{r.description}</p>}<p className="text-xs text-gray-400">{r.file_name} · {bytes(r.size_bytes)}</p></div> },
      { header: 'Category', cell: (r) => r.category ?? '—' }, { header: 'Added', cell: (r) => date(r.created_at) },
      { header: '', cell: (r) => <button className="btn-ghost !p-1.5" title="Download" onClick={() => openFile('agent-resources', r.storage_path, r.file_name).catch(() => toast('Could not open the file', 'err'))}><Download size={15} /></button> }]} />}</Async></>)
}
