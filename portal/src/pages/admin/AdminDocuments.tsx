import { useState, type FormEvent } from 'react'
import { Download, History, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, SearchBox, Select, Table, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { ACCEPT, checkFile, openFile, upload } from '../../lib/files'
import { bytes, clean, date, label } from '../../lib/format'
import type { Client, Doc, DocReview } from '../../lib/types'

type Row = Doc & { clients: { company_name: string | null; profiles: { full_name: string } } | null }

export default function AdminDocuments() {
  const { role } = useAuth()
  const q = useQuery(async () => ok(await supabase.from('documents').select('*, projects(title), clients(company_name, profiles(full_name))').order('created_at', { ascending: false })) as unknown as Row[], [])
  const [s, setS] = useState(''); const [st, setSt] = useState('all'); const [dir, setDir] = useState('all')
  const [up, setUp] = useState(false); const [view, setView] = useState<Row | null>(null)
  const { toast } = useFeedback()
  const canUpload = role !== 'accountant' && role !== 'support_officer'
  return (
    <>
      <PageHeader title="Documents" sub="Share documents with clients and review files they upload." actions={canUpload && <button className="btn-primary" onClick={() => setUp(true)}><Upload size={16} />Upload for client</button>} />
      <div className="mb-3 flex flex-wrap gap-2"><SearchBox value={s} onChange={setS} placeholder="Search documents or clients" />
        <Select value={st} onChange={setSt} options={['pending', 'approved', 'rejected']} all="All statuses" />
        <select className="input !w-auto" value={dir} onChange={(e) => setDir(e.target.value)}><option value="all">All documents</option><option value="from_client">Uploaded by clients</option><option value="to_client">Shared with clients</option></select></div>
      <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No documents yet" />}>{(rows) =>
        <Table rows={rows.filter((d) => (st === 'all' || d.status === st) && (dir === 'all' || d.direction === dir) && matches(s, d.title, d.file_name, d.clients?.profiles.full_name, d.projects?.title))} cols={[
          { header: 'Document', cell: (d) => <div><p className="font-semibold">{d.title}</p><p className="text-xs text-gray-500">{d.file_name} · {bytes(d.size_bytes)}</p></div> },
          { header: 'Client', cell: (d) => d.clients?.profiles.full_name }, { header: 'Project', cell: (d) => d.projects?.title ?? '—' },
          { header: 'Direction', cell: (d) => <span className="text-xs">{d.direction === 'from_client' ? 'From client' : 'To client'}</span> }, { header: 'Date', cell: (d) => date(d.created_at) }, { header: 'Status', cell: (d) => <Badge s={d.status} /> },
          { header: '', cell: (d) => <div className="flex gap-1"><button className="btn-ghost !p-1.5" title="Review & history" onClick={() => setView(d)}><History size={15} /></button><button className="btn-ghost !p-1.5" title="Download" onClick={() => openFile('documents', d.storage_path, d.file_name).catch(() => toast('Could not open the file', 'err'))}><Download size={15} /></button></div> },
        ]} />}</Async>
      {up && <UploadForm onClose={() => setUp(false)} onDone={() => { setUp(false); q.reload() }} />}
      {view && <ReviewModal doc={view} canReview={role === 'super_admin' || role === 'admin' || role === 'project_manager'} onClose={() => setView(null)} onChanged={q.reload} />}
    </>
  )
}

function UploadForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const clients = useQuery(async () => ok(await supabase.from('clients').select('id, profiles!inner(full_name, status)').eq('profiles.status', 'active')) as unknown as (Client & { profiles: { full_name: string } })[], [])
  const projects = useQuery(async () => ok(await supabase.from('projects').select('id, title, client_id').eq('archived', false)) as { id: string; title: string; client_id: string }[], [])
  const [f, setF] = useState({ client: '', project: '', title: '', category: 'Contract' }); const [file, setFile] = useState<File | null>(null)
  const { run, busy } = useAction(); const { toast } = useFeedback()
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!file) return
    const bad = checkFile(file); if (bad) return toast(bad, 'err')
    const d = await run(async () => {
      const path = await upload('documents', f.client, file)
      const r = await supabase.from('documents').insert({ title: clean(f.title), category: f.category, client_id: f.client, project_id: f.project || null, direction: 'to_client', storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size })
      if (r.error) { await supabase.storage.from('documents').remove([path]); throw r.error } }, 'Document shared with client'); if (d) onDone() }
  return <Modal title="Upload document for a client" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <Field label="Client"><select className="input" required value={f.client} onChange={(e) => setF({ ...f, client: e.target.value, project: '' })}><option value="">Select client…</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.profiles.full_name}</option>)}</select></Field>
    <Field label="Project (optional)"><select className="input" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">None</option>{(projects.data ?? []).filter((p) => p.client_id === f.client).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Title"><input className="input" required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['Contract', 'Proposal', 'Invoice', 'Plan / drawing', 'Certificate', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></Field></div>
    <Field label="File" hint="PDF, DOCX, XLSX, JPG or PNG, up to 20 MB."><input className="input" type="file" required accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !f.client || !file}>Upload &amp; notify</button></div></form></Modal>
}

function ReviewModal({ doc, canReview, onClose, onChanged }: { doc: Row; canReview: boolean; onClose: () => void; onChanged: () => void }) {
  const q = useQuery(async () => ok(await supabase.from('document_reviews').select('*, profiles(full_name)').eq('document_id', doc.id).order('created_at')) as unknown as DocReview[], [doc.id])
  const [comment, setComment] = useState(''); const { run, busy } = useAction()
  const act = async (decision: 'approved' | 'rejected' | 'comment') => {
    if (decision === 'rejected' && !comment.trim()) return alert('Please add a comment explaining the rejection.')
    const d = await run(async () => { ok(await supabase.from('document_reviews').insert({ document_id: doc.id, decision, comment: clean(comment) || null })) }, decision === 'comment' ? 'Comment added' : `Document ${decision}`)
    if (d) { setComment(''); q.reload(); onChanged() } }
  return <Modal title={doc.title} onClose={onClose}>
    <p className="mb-3 text-sm text-gray-600">{doc.clients?.profiles.full_name} · <Badge s={doc.status} /></p>
    <h3 className="mb-2 text-sm font-semibold">History</h3>
    <Async q={q} empty={(d) => d.length === 0 && <p className="py-3 text-sm text-gray-500">No reviews yet.</p>}>{(rows) => <ul className="mb-4 space-y-2">{rows.map((r) => <li key={r.id} className="rounded-lg bg-brand-grey p-3 text-sm"><p className="font-semibold">{label(r.decision)} <span className="font-normal text-gray-500">· {r.profiles?.full_name} · {date(r.created_at)}</span></p>{r.comment && <p>{r.comment}</p>}</li>)}</ul>}</Async>
    {canReview && <div className="space-y-2 border-t pt-3"><textarea className="input" rows={2} maxLength={1000} placeholder="Review comment (required when rejecting)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex flex-wrap justify-end gap-2"><button className="btn-ghost" disabled={busy || !comment.trim()} onClick={() => act('comment')}>Comment</button><button className="btn-danger" disabled={busy} onClick={() => act('rejected')}>Reject</button><button className="btn-primary" disabled={busy} onClick={() => act('approved')}>Approve</button></div></div>}
  </Modal>
}
