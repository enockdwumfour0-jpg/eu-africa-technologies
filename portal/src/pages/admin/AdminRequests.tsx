import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, SearchBox, Select, Table, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { clean, date, dateTime } from '../../lib/format'
import { useStaff } from '../../lib/hooks'
import type { ProjectRequest } from '../../lib/types'

type Row = ProjectRequest & { clients: { company_name: string | null; profiles: { full_name: string; email: string; phone: string | null } } | null }
type Note = { id: string; note: string; created_at: string; profiles: { full_name: string } | null }

export default function AdminRequests() {
  const q = useQuery(async () => ok(await supabase.from('project_requests').select('*, clients(company_name, profiles(full_name, email, phone))').order('created_at', { ascending: false })) as unknown as Row[], [])
  const [s, setS] = useState(''); const [st, setSt] = useState('all'); const [open, setOpen] = useState<Row | null>(null)
  return (
    <>
      <PageHeader title="Project requests" sub="Review incoming requests, add internal notes and convert approved requests into projects." />
      <div className="mb-3 flex flex-wrap gap-2"><SearchBox value={s} onChange={setS} placeholder="Search requests" /><Select value={st} onChange={setSt} options={['submitted', 'under_review', 'approved', 'rejected', 'converted']} all="All statuses" /></div>
      <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No requests yet" />}>{(rows) =>
        <Table rows={rows.filter((r) => (st === 'all' || r.status === st) && matches(s, r.title, r.clients?.profiles.full_name, r.service_type))} onRow={setOpen} cols={[
          { header: 'Request', cell: (r) => <div><p className="font-semibold">{r.title}</p><p className="text-xs text-gray-500">{r.service_type}</p></div> },
          { header: 'Client', cell: (r) => r.clients?.profiles.full_name }, { header: 'Submitted', cell: (r) => date(r.created_at) }, { header: 'Status', cell: (r) => <Badge s={r.status} /> }]} />}</Async>
      {open && <Review r={open} onClose={() => setOpen(null)} onChanged={() => { q.reload() }} />}
    </>
  )
}

function Review({ r, onClose, onChanged }: { r: Row; onClose: () => void; onChanged: () => void }) {
  const { role, session } = useAuth(); const nav = useNavigate()
  const canDecide = role === 'super_admin' || role === 'admin'
  const { run, busy } = useAction(); const { confirm } = useFeedback()
  const staff = useStaff()
  const [cur, setCur] = useState(r); const [note, setNote] = useState(''); const [decision, setDecision] = useState(r.decision_note ?? ''); const [mgr, setMgr] = useState('')
  const notes = useQuery(async () => ok(await supabase.from('project_request_notes').select('id, note, created_at, profiles(full_name)').eq('request_id', r.id).order('created_at')) as unknown as Note[], [r.id])
  const patch = async (body: Record<string, unknown>, msg: string) => { const d = await run(async () => { ok(await supabase.from('project_requests').update(body).eq('id', r.id)) }, msg); if (d) { setCur({ ...cur, ...body } as Row); onChanged() } }
  const addNote = async () => { if (!clean(note)) return; const d = await run(async () => { ok(await supabase.from('project_request_notes').insert({ request_id: r.id, author_id: session!.user.id, note: clean(note) })) }, 'Note added'); if (d) { setNote(''); notes.reload() } }
  const convert = async () => { if (!(await confirm({ title: 'Convert to a project?', text: 'A new project with the standard 10 stages will be created for this client.', action: 'Convert' }))) return
    let pid = ''; const d = await run(async () => { pid = ok(await supabase.rpc('convert_request_to_project', { p_request: r.id, p_manager: mgr || null })) as string }, 'Project created'); if (d) { onChanged(); onClose(); nav(`/admin/projects/${pid}`) } }
  return (
    <Modal title={cur.title} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm"><Badge s={cur.status} /><span className="text-gray-600">{r.clients?.profiles.full_name} · {r.clients?.profiles.email} · {r.clients?.profiles.phone}</span></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{([['Service', r.service_type], ['Location', r.location], ['Budget range', r.budget_range], ['Preferred start', date(r.preferred_start)], ['Submitted', dateTime(r.created_at)]] as [string, string | null][]).map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase text-gray-500">{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
        <p className="whitespace-pre-wrap rounded-lg bg-brand-grey p-3 text-sm">{r.description}</p>
        {canDecide && cur.status !== 'converted' && <div className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assign to"><select className="input" value={cur.assigned_to ?? ''} onChange={(e) => patch({ assigned_to: e.target.value || null }, 'Assigned')}><option value="">Unassigned</option>{(staff.data ?? []).filter((s) => s.status === 'active' && s.role !== 'client').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
            <Field label="Decision note (shown to client)"><input className="input" maxLength={500} value={decision} onChange={(e) => setDecision(e.target.value)} /></Field></div>
          <div className="flex flex-wrap gap-2">
            {cur.status === 'submitted' && <button className="btn-ghost" disabled={busy} onClick={() => patch({ status: 'under_review' }, 'Marked under review')}>Start review</button>}
            {cur.status !== 'approved' && <button className="btn-primary" disabled={busy} onClick={() => patch({ status: 'approved', decision_note: clean(decision) || null }, 'Request approved')}>Approve</button>}
            {cur.status !== 'rejected' && <button className="btn-danger" disabled={busy} onClick={() => patch({ status: 'rejected', decision_note: clean(decision) || null }, 'Request rejected')}>Reject</button>}</div>
          {cur.status === 'approved' && <div className="flex flex-wrap items-end gap-2 border-t pt-3"><Field label="Project manager (optional)"><select className="input" value={mgr} onChange={(e) => setMgr(e.target.value)}><option value="">Assign later</option>{(staff.data ?? []).filter((s) => s.role === 'project_manager' && s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field><button className="btn-gold" disabled={busy} onClick={convert}>Convert to project</button></div>}
        </div>}
        <section><h3 className="mb-2 font-semibold">Internal notes <span className="text-xs font-normal text-gray-500">(never visible to the client)</span></h3>
          <Async q={notes} empty={(d) => d.length === 0 && <p className="text-sm text-gray-500">No notes yet.</p>}>{(rows) => <ul className="space-y-2">{rows.map((n) => <li key={n.id} className="rounded-lg bg-yellow-50 p-2.5 text-sm"><p>{n.note}</p><p className="text-[11px] text-gray-500">{n.profiles?.full_name} · {dateTime(n.created_at)}</p></li>)}</ul>}</Async>
          <div className="mt-2 flex gap-2"><input className="input" placeholder="Add a note…" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-ghost" onClick={addNote} disabled={busy || !note.trim()}>Add</button></div></section>
      </div>
    </Modal>
  )
}
