import { useState, type FormEvent } from 'react'
import { Download, FileText, MessageSquareText, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, SearchBox, Select, Table, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { ACCEPT, checkFile, openFile, upload } from '../../lib/files'
import { bytes, clean, date, label } from '../../lib/format'
import { useMyClient } from '../../lib/hooks'
import type { Doc, DocReview } from '../../lib/types'

export default function ClientDocuments() {
  const me = useMyClient()
  const q = useQuery(async () => ok(await supabase.from('documents').select('*, projects(title)').order('created_at', { ascending: false })) as unknown as Doc[], [])
  const [s, setS] = useState('')
  const [st, setSt] = useState('all')
  const [up, setUp] = useState(false)
  const [view, setView] = useState<Doc | null>(null)
  const { toast } = useFeedback()
  const dl = (d: Doc) => openFile('documents', d.storage_path, d.file_name).catch(() => toast('Could not open the file', 'err'))
  return (
    <>
      <PageHeader title="Documents" sub="Documents shared with you and files you have uploaded." actions={<button className="btn-primary" onClick={() => setUp(true)}><Upload size={16} />Upload document</button>} />
      <div className="mb-3 flex flex-wrap gap-2"><SearchBox value={s} onChange={setS} placeholder="Search documents" /><Select value={st} onChange={setSt} options={['pending', 'approved', 'rejected']} all="All statuses" /></div>
      <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No documents yet" icon={<FileText size={32} />} text="Contracts and files shared by EU-AFRIC, and anything you upload, appear here." />}>
        {(rows) => <Table rows={rows.filter((d) => (st === 'all' || d.status === st) && matches(s, d.title, d.file_name, d.category))} cols={[
          { header: 'Document', cell: (d) => <div><p className="font-semibold">{d.title}</p><p className="text-xs text-gray-500">{d.file_name} · {bytes(d.size_bytes)}</p></div> },
          { header: 'Type', cell: (d) => <span className="text-xs">{d.direction === 'to_client' ? 'From EU-AFRIC' : 'Uploaded by you'}</span> },
          { header: 'Project', cell: (d) => <span className="text-xs">{d.projects?.title ?? '—'}</span> },
          { header: 'Date', cell: (d) => date(d.created_at) },
          { header: 'Status', cell: (d) => <Badge s={d.status} /> },
          { header: '', cell: (d) => (
            <div className="flex gap-1">
              <button className="btn-ghost !p-1.5" title="Review comments" onClick={() => setView(d)}><MessageSquareText size={15} /></button>
              {(d.direction === 'from_client' || d.status === 'approved') && <button className="btn-ghost !p-1.5" title="Download" onClick={() => dl(d)}><Download size={15} /></button>}
            </div>) },
        ]} />}
      </Async>
      {up && me.data && <UploadForm clientId={me.data.id} onClose={() => setUp(false)} onDone={() => { setUp(false); q.reload() }} />}
      {view && <Reviews doc={view} onClose={() => setView(null)} />}
    </>
  )
}
function UploadForm({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const projects = useQuery(async () => ok(await supabase.from('projects').select('id, title').eq('archived', false)) as { id: string; title: string }[], [])
  const [title, setTitle] = useState(''); const [cat, setCat] = useState('Identification'); const [proj, setProj] = useState(''); const [file, setFile] = useState<File | null>(null)
  const { run, busy } = useAction(); const { toast } = useFeedback()
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!file) return
    const bad = checkFile(file); if (bad) return toast(bad, 'err')
    const done = await run(async () => {
      const path = await upload('documents', clientId, file)
      const { error } = await supabase.from('documents').insert({ title: clean(title), category: cat, client_id: clientId, project_id: proj || null, direction: 'from_client', storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size })
      if (error) { await supabase.storage.from('documents').remove([path]); throw error }
    }, 'Document uploaded. It will be reviewed by our team.')
    if (done) onDone()
  }
  return (
    <Modal title="Upload a document" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title"><input className="input" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category"><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{['Identification', 'Land document', 'Building plan', 'Proof of payment', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Project (optional)"><select className="input" value={proj} onChange={(e) => setProj(e.target.value)}><option value="">None</option>{(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
        </div>
        <Field label="File" hint="PDF, DOCX, XLSX, JPG or PNG, up to 20 MB."><input className="input" type="file" required accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !file}>Upload</button></div>
      </form>
    </Modal>
  )
}
export function Reviews({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const q = useQuery(async () => ok(await supabase.from('document_reviews').select('*, profiles(full_name)').eq('document_id', doc.id).order('created_at')) as unknown as DocReview[], [doc.id])
  return (
    <Modal title={doc.title} onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">Status: <Badge s={doc.status} /></p>
      <Async q={q} empty={(d) => d.length === 0 && <p className="py-4 text-sm text-gray-500">No review comments yet.</p>}>
        {(rows) => <ul className="space-y-2">{rows.map((r) => <li key={r.id} className="rounded-lg bg-brand-grey p-3 text-sm"><p className="font-semibold">{label(r.decision)} <span className="font-normal text-gray-500">· {r.profiles?.full_name ?? 'EU-AFRIC'} · {date(r.created_at)}</span></p>{r.comment && <p className="mt-0.5 text-gray-700">{r.comment}</p>}</li>)}</ul>}
      </Async>
    </Modal>
  )
}
