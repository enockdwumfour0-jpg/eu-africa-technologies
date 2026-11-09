import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ArrowLeft, Camera, ImagePlus, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, Progress, SearchBox, Select, Table, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { MilestoneTracker, UpdatesTimeline } from '../../components/Tracking'
import { checkFile, upload } from '../../lib/files'
import { clean, date, label, num } from '../../lib/format'
import { useStaff } from '../../lib/hooks'
import type { Client, Milestone, Project, ProjectUpdate } from '../../lib/types'

type Row = Project & { clients: { company_name: string | null; profiles: { full_name: string } } | null }
const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled']
const canCreate = (r: string | null) => r === 'super_admin' || r === 'admin'

export default function AdminProjects() {
  const { role } = useAuth()
  const nav = useNavigate()
  const [archived, setArchived] = useState(false)
  const q = useQuery(async () => ok(await supabase.from('projects').select('*, clients(company_name, profiles(full_name))').eq('archived', archived).order('created_at', { ascending: false })) as unknown as Row[], [archived])
  const [s, setS] = useState(''); const [st, setSt] = useState('all'); const [form, setForm] = useState<Row | 'new' | null>(null)
  return (
    <>
      <PageHeader title={role === 'project_manager' ? 'My assigned projects' : 'Projects'} sub={role === 'project_manager' ? 'Projects assigned to you. Update milestones, progress and photos.' : 'Create projects, assign teams and track delivery.'}
        actions={canCreate(role) && <button className="btn-primary" onClick={() => setForm('new')}><Plus size={16} />New project</button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2"><SearchBox value={s} onChange={setS} placeholder="Search projects" /><Select value={st} onChange={setSt} options={STATUSES} all="All statuses" />
        {canCreate(role) && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label>}</div>
      <Async q={q} empty={(d) => d.length === 0 && <EmptyState title={archived ? 'No archived projects' : 'No projects yet'} text={role === 'project_manager' ? 'You have not been assigned to any projects.' : undefined} />}>
        {(rows) => <Table rows={rows.filter((r) => (st === 'all' || r.status === st) && matches(s, r.title, r.code, r.clients?.profiles.full_name, r.clients?.company_name))} onRow={(r) => nav(`/admin/projects/${r.id}`)} cols={[
          { header: 'Project', cell: (r) => <div><p className="font-semibold">{r.title}</p><p className="text-xs text-gray-500">{r.code}</p></div> },
          { header: 'Client', cell: (r) => r.clients?.profiles.full_name || r.clients?.company_name || '—' }, { header: 'Status', cell: (r) => <Badge s={r.status} /> },
          { header: 'Progress', className: 'w-40', cell: (r) => <Progress value={r.progress} /> }, { header: 'ETA', cell: (r) => date(r.estimated_completion) },
        ]} />}
      </Async>
      {form && <ProjectForm project={form === 'new' ? null : form} onClose={() => setForm(null)} onDone={() => { setForm(null); q.reload() }} />}
    </>
  )
}

function ProjectForm({ project, onClose, onDone }: { project: Row | null; onClose: () => void; onDone: () => void }) {
  const { role, session } = useAuth()
  const admin = canCreate(role)
  const clients = useQuery(async () => ok(await supabase.from('clients').select('id, company_name, profiles!inner(full_name, status)').eq('profiles.status', 'active')) as unknown as (Client & { profiles: { full_name: string } })[], [])
  const staff = useStaff()
  const [f, setF] = useState({
    title: project?.title ?? '', description: project?.description ?? '', client_id: project?.client_id ?? '', status: project?.status ?? 'planning',
    location: project?.location ?? '', start_date: project?.start_date ?? '', estimated_completion: project?.estimated_completion ?? '', manager: '',
  })
  const { run, busy } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const done = await run(async () => {
      const body = { title: clean(f.title), description: clean(f.description) || null, status: f.status, location: clean(f.location) || null, start_date: f.start_date || null, estimated_completion: f.estimated_completion || null }
      if (project) { const r = await supabase.from('projects').update(admin ? { ...body, client_id: f.client_id } : body).eq('id', project.id); if (r.error) throw r.error }
      else {
        const r = await supabase.from('projects').insert({ ...body, client_id: f.client_id, created_by: session!.user.id }).select('id').single(); if (r.error) throw r.error
        if (f.manager) { const m = await supabase.from('project_members').insert({ project_id: r.data.id, user_id: f.manager, member_role: 'manager', assigned_by: session!.user.id }); if (m.error) throw m.error }
      }
    }, project ? 'Project updated' : 'Project created')
    if (done) onDone()
  }
  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title"><input className="input" required maxLength={160} value={f.title} onChange={set('title')} /></Field>
        <Field label="Description"><textarea className="input" rows={3} maxLength={4000} value={f.description} onChange={set('description')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client"><select className="input" required disabled={!admin} value={f.client_id} onChange={set('client_id')}><option value="">Select client…</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.profiles.full_name || c.company_name}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={f.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
          <Field label="Location"><input className="input" maxLength={200} value={f.location} onChange={set('location')} /></Field>
          {!project && <Field label="Project manager"><select className="input" value={f.manager} onChange={set('manager')}><option value="">Assign later</option>{(staff.data ?? []).filter((s) => s.role === 'project_manager' && s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>}
          <Field label="Start date"><input type="date" className="input" value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label="Estimated completion"><input type="date" className="input" value={f.estimated_completion} onChange={set('estimated_completion')} /></Field>
        </div>
        {!project && <p className="text-xs text-gray-500">The standard 10 project stages are created automatically.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{project ? 'Save changes' : 'Create project'}</button></div>
      </form>
    </Modal>
  )
}

export function AdminProjectDetail() {
  const { id } = useParams()
  const { role } = useAuth(); const admin = canCreate(role)
  const { confirm } = useFeedback(); const { run } = useAction()
  const [edit, setEdit] = useState(false); const [ms, setMs] = useState<Milestone | 'new' | null>(null); const [upd, setUpd] = useState(false); const [assign, setAssign] = useState(false)
  const q = useQuery(async () => {
    const [p, m, u, mem] = await Promise.all([
      supabase.from('projects').select('*, clients(company_name, profiles(full_name, email))').eq('id', id!).maybeSingle(),
      supabase.from('project_milestones').select('*').eq('project_id', id!).order('position'),
      supabase.from('project_updates').select('*, profiles(full_name)').eq('project_id', id!).order('created_at', { ascending: false }),
      supabase.from('project_members').select('user_id, member_role, profiles(full_name, email)').eq('project_id', id!),
    ])
    return { p: ok(p) as unknown as Row | null, m: ok(m) as Milestone[], u: ok(u) as unknown as ProjectUpdate[], mem: ok(mem) as unknown as { user_id: string; member_role: string; profiles: { full_name: string; email: string } | null }[] }
  }, [id])
  const toggleArchive = async (p: Row) => { if (await confirm({ title: p.archived ? 'Restore this project?' : 'Archive this project?', text: p.archived ? undefined : 'It will be hidden from client and staff lists but kept in the records.', action: p.archived ? 'Restore' : 'Archive' })) { await run(async () => { ok(await supabase.from('projects').update({ archived: !p.archived }).eq('id', p.id)) }, p.archived ? 'Project restored' : 'Project archived'); q.reload() } }
  const delMs = async (m: Milestone) => { if (await confirm({ title: `Delete stage "${m.title}"?`, action: 'Delete', danger: true })) { await run(async () => { ok(await supabase.from('project_milestones').delete().eq('id', m.id)) }, 'Stage deleted'); q.reload() } }
  const setMsStatus = async (m: Milestone, status: string) => { await run(async () => { ok(await supabase.from('project_milestones').update({ status }).eq('id', m.id)) }); q.reload() }
  const removeMember = async (uid: string) => { if (await confirm({ title: 'Remove this team member?', action: 'Remove', danger: true })) { await run(async () => { ok(await supabase.from('project_members').delete().eq('project_id', id!).eq('user_id', uid)) }, 'Removed'); q.reload() } }
  return (
    <>
      <Link to="/admin/projects" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-green"><ArrowLeft size={14} />All projects</Link>
      <Async q={q} empty={(d) => !d.p && <EmptyState title="Project not found" />}>{({ p, m, u, mem }) => p && (
        <div className="space-y-5">
          <PageHeader title={p.title} sub={`${p.code} · ${p.clients?.profiles.full_name ?? ''}`} actions={<>
            <button className="btn-ghost" onClick={() => setEdit(true)}><Pencil size={15} />Edit</button>
            {admin && <button className="btn-ghost" onClick={() => toggleArchive(p)}>{p.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{p.archived ? 'Restore' : 'Archive'}</button>}</>} />
          <div className="card"><div className="flex flex-wrap items-center justify-between gap-2"><Badge s={p.status} /><span className="text-sm text-gray-600">ETA {date(p.estimated_completion)} · Started {date(p.start_date)}</span></div>
            <div className="mt-3"><Progress value={p.progress} /></div>{p.description && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{p.description}</p>}</div>
          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-5">
              <section className="card"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Stages</h2><button className="btn-ghost !py-1 text-xs" onClick={() => setMs('new')}><Plus size={13} />Add stage</button></div>
                <MilestoneTracker items={m} />
                <div className="mt-4 divide-y border-t">{m.map((x) => (
                  <div key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{x.position}. {x.title}</span>
                    <select className="input !w-auto !py-1 text-xs" value={x.status} onChange={(e) => setMsStatus(x, e.target.value)}>{['upcoming', 'current', 'completed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
                    <button className="p-1 text-gray-500 hover:text-brand-green" onClick={() => setMs(x)} aria-label="Edit stage"><Pencil size={14} /></button>
                    <button className="p-1 text-gray-500 hover:text-red-600" onClick={() => delMs(x)} aria-label="Delete stage"><Trash2 size={14} /></button></div>))}</div></section>
              <section className="card"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Team</h2>{admin && <button className="btn-ghost !py-1 text-xs" onClick={() => setAssign(true)}><UserPlus size={13} />Assign</button>}</div>
                {mem.length === 0 ? <p className="text-sm text-gray-500">No one assigned yet.</p> : <ul className="divide-y">{mem.map((t) => <li key={t.user_id} className="flex items-center justify-between py-2 text-sm"><span>{t.profiles?.full_name || t.profiles?.email} <span className="text-xs text-gray-500">({t.member_role})</span></span>{admin && <button className="text-xs font-semibold text-red-600" onClick={() => removeMember(t.user_id)}>Remove</button>}</li>)}</ul>}</section>
            </div>
            <section className="card"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Progress updates</h2><button className="btn-primary !py-1.5 text-xs" onClick={() => setUpd(true)}><Camera size={14} />Post update</button></div><UpdatesTimeline items={u} showAuthor /></section>
          </div>
          {edit && <ProjectForm project={p} onClose={() => setEdit(false)} onDone={() => { setEdit(false); q.reload() }} />}
          {ms && <MilestoneForm projectId={p.id} milestone={ms === 'new' ? null : ms} next={m.length + 1} onClose={() => setMs(null)} onDone={() => { setMs(null); q.reload() }} />}
          {upd && <UpdateForm projectId={p.id} onClose={() => setUpd(false)} onDone={() => { setUpd(false); q.reload() }} />}
          {assign && <AssignForm projectId={p.id} existing={mem.map((x) => x.user_id)} onClose={() => setAssign(false)} onDone={() => { setAssign(false); q.reload() }} />}
        </div>)}</Async>
    </>
  )
}

function MilestoneForm({ projectId, milestone, next, onClose, onDone }: { projectId: string; milestone: Milestone | null; next: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: milestone?.title ?? '', description: milestone?.description ?? '', due_date: milestone?.due_date ?? '', position: String(milestone?.position ?? next) })
  const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault()
    const d = await run(async () => {
      const body = { title: clean(f.title), description: clean(f.description) || null, due_date: f.due_date || null, position: Math.max(1, Math.round(num(f.position))) }
      const r = milestone ? await supabase.from('project_milestones').update(body).eq('id', milestone.id) : await supabase.from('project_milestones').insert({ ...body, project_id: projectId })
      if (r.error) throw r.error }, 'Stage saved'); if (d) onDone() }
  return <Modal title={milestone ? 'Edit stage' : 'Add stage'} onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Title"><input className="input" required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    <Field label="Description"><textarea className="input" rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Position"><input className="input" type="number" min={1} value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></Field><Field label="Due date"><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field></div>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div></form></Modal>
}

function UpdateForm({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const { session } = useAuth()
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [visible, setVisible] = useState(true); const [files, setFiles] = useState<File[]>([])
  const { run, busy } = useAction(); const { toast } = useFeedback()
  const pick = (list: FileList | null) => { const arr = Array.from(list ?? []).slice(0, 12); const bad = arr.map((f) => checkFile(f, { images: true, maxMB: 10 })).find(Boolean); if (bad) return toast(bad, 'err'); setFiles(arr) }
  const submit = async (e: FormEvent) => { e.preventDefault()
    const d = await run(async () => {
      const paths: string[] = []
      try { for (const f of files) paths.push(await upload('project-photos', projectId, f)) }
      catch (err) { if (paths.length) await supabase.storage.from('project-photos').remove(paths); throw err }
      const r = await supabase.from('project_updates').insert({ project_id: projectId, author_id: session!.user.id, title: clean(title), body: clean(body) || null, photo_paths: paths, visible_to_client: visible })
      if (r.error) { if (paths.length) await supabase.storage.from('project-photos').remove(paths); throw r.error }
    }, 'Update posted'); if (d) onDone() }
  return <Modal title="Post a progress update" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <Field label="Title"><input className="input" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field label="Description"><textarea className="input" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
    <Field label="Photographs" hint="JPG or PNG, up to 12 photos, 10 MB each."><div className="flex items-center gap-2"><label className="btn-ghost cursor-pointer"><ImagePlus size={15} />Choose photos<input type="file" multiple accept="image/jpeg,image/png" className="hidden" onChange={(e) => pick(e.target.files)} /></label><span className="text-sm text-gray-600">{files.length ? `${files.length} selected` : ''}</span></div></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />Visible to the client (a notification is sent)</label>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post update'}</button></div></form></Modal>
}

function AssignForm({ projectId, existing, onClose, onDone }: { projectId: string; existing: string[]; onClose: () => void; onDone: () => void }) {
  const staff = useStaff(); const [uid, setUid] = useState(''); const [role, setRole] = useState('manager'); const { run, busy } = useAction()
  const opts = (staff.data ?? []).filter((s) => s.status === 'active' && !existing.includes(s.id) && ['project_manager', 'admin', 'super_admin'].includes(s.role))
  const submit = async (e: FormEvent) => { e.preventDefault(); const d = await run(async () => { ok(await supabase.from('project_members').insert({ project_id: projectId, user_id: uid, member_role: role })) }, 'Team member assigned'); if (d) onDone() }
  return <Modal title="Assign team member" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Staff member"><select className="input" required value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Select…</option>{opts.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({label(s.role)})</option>)}</select></Field>
    <Field label="Role on project"><select className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="manager">Manager</option><option value="staff">Staff</option></select></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !uid}>Assign</button></div></form></Modal>
}
