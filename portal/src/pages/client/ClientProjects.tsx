import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, MapPin, Plus, UserRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, Progress, Table, Tabs, ok, useAction, useQuery } from '../../components/ui'
import { MilestoneTracker, UpdatesTimeline } from '../../components/Tracking'
import { clean, date, dateTime } from '../../lib/format'
import { useMyClient } from '../../lib/hooks'
import type { Milestone, Project, ProjectRequest, ProjectUpdate } from '../../lib/types'

export default function ClientProjects() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'requests' ? 'requests' : 'projects'
  return (
    <>
      <PageHeader title="My projects" sub="Track progress, milestones and photos for your projects." />
      <Tabs value={tab} onChange={(t) => setParams(t === 'projects' ? {} : { tab: t })} tabs={[{ id: 'projects', label: 'Projects' }, { id: 'requests', label: 'My requests' }]} />
      {tab === 'projects' ? <List /> : <Requests />}
    </>
  )
}

function List() {
  const q = useQuery(async () => ok(await supabase.from('projects').select('*').eq('archived', false).order('created_at', { ascending: false })) as Project[], [])
  return (
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No projects yet" text="Once your request is approved, your project will appear here." action={<Link to="/portal/projects?tab=requests" className="btn-primary">Submit a project request</Link>} />}>
      {(rows) => (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((p) => (
            <Link key={p.id} to={`/portal/projects/${p.id}`} className="card block transition hover:border-brand-green hover:shadow-md">
              <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-gray-500">{p.code}</p><h3 className="font-display text-lg font-semibold">{p.title}</h3></div><Badge s={p.status} /></div>
              {p.description && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{p.description}</p>}
              <div className="mt-3"><Progress value={p.progress} /></div>
              <p className="mt-2 flex items-center gap-1 text-xs text-gray-500"><CalendarClock size={13} />Estimated completion: {date(p.estimated_completion)}</p>
            </Link>
          ))}
        </div>)}
    </Async>
  )
}

export function ProjectDetail({ base = '/portal' }: { base?: string } = {}) {
  const { id } = useParams()
  const q = useQuery(async () => {
    const [p, m, u, mem] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id!).maybeSingle(),
      supabase.from('project_milestones').select('*').eq('project_id', id!).order('position'),
      supabase.from('project_updates').select('*, profiles(full_name)').eq('project_id', id!).order('created_at', { ascending: false }),
      supabase.from('project_members').select('member_role, profiles(full_name, phone, email)').eq('project_id', id!),
    ])
    return {
      project: ok(p) as Project | null, ms: ok(m) as Milestone[], ups: ok(u) as unknown as ProjectUpdate[],
      team: ok(mem) as unknown as { member_role: string; profiles: { full_name: string; phone: string | null; email: string } | null }[],
    }
  }, [id])
  return (
    <>
      <Link to={`${base}/projects`} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-green"><ArrowLeft size={14} />All projects</Link>
      <Async q={q} empty={(d) => !d.project && <EmptyState title="Project not found" text="It may not be linked to your account." />}>
        {({ project: p, ms, ups, team }) => p && (
          <div className="space-y-5">
            <div className="card">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold text-gray-500">{p.code}</p><h1 className="font-display text-2xl font-semibold">{p.title}</h1></div><Badge s={p.status} /></div>
              {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{p.description}</p>}
              <div className="mt-4"><Progress value={p.progress} /></div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs font-semibold uppercase text-gray-500">Project manager</dt><dd className="flex items-center gap-1"><UserRound size={14} />{team.filter((t) => t.member_role === 'manager').map((t) => t.profiles?.full_name).filter(Boolean).join(', ') || 'To be assigned'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-gray-500">Location</dt><dd className="flex items-center gap-1"><MapPin size={14} />{p.location || '—'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-gray-500">Started</dt><dd>{date(p.start_date)}</dd></div>
                <div><dt className="text-xs font-semibold uppercase text-gray-500">Estimated completion</dt><dd>{date(p.estimated_completion)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">Last update: {dateTime(ups[0]?.created_at ?? p.updated_at)}</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
              <section className="card"><h2 className="mb-4 font-semibold">Project stages</h2><MilestoneTracker items={ms} /></section>
              <section className="card"><h2 className="mb-4 font-semibold">Progress history &amp; photos</h2><UpdatesTimeline items={ups} /></section>
            </div>
          </div>)}
      </Async>
    </>
  )
}

const SERVICES = ['Building construction', 'Block supply', 'Solar installation', 'Land purchase', 'Property enquiry', 'Other']
function Requests() {
  const me = useMyClient()
  const q = useQuery(async () => ok(await supabase.from('project_requests').select('*').order('created_at', { ascending: false })) as ProjectRequest[], [])
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />New request</button></div>
      <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No requests yet" text="Tell us what you would like to build or buy." />}>
        {(rows) => <Table rows={rows} cols={[
          { header: 'Request', cell: (r) => <div><p className="font-semibold">{r.title}</p><p className="line-clamp-1 text-xs text-gray-500">{r.service_type}</p></div> },
          { header: 'Submitted', cell: (r) => date(r.created_at) },
          { header: 'Status', cell: (r) => <Badge s={r.status} /> },
          { header: 'Decision note', cell: (r) => <span className="text-xs text-gray-600">{r.decision_note ?? '—'}</span> },
        ]} />}
      </Async>
      {open && me.data && <RequestForm clientId={me.data.id} onClose={() => setOpen(false)} onDone={() => { setOpen(false); q.reload() }} />}
    </>
  )
}
function RequestForm({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', service_type: SERVICES[0]!, description: '', location: '', budget_range: '', preferred_start: '' })
  const { run, busy } = useAction()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const done = await run(async () => {
      const { error } = await supabase.from('project_requests').insert({
        client_id: clientId, title: clean(f.title), service_type: f.service_type, description: clean(f.description),
        location: clean(f.location) || null, budget_range: clean(f.budget_range) || null, preferred_start: f.preferred_start || null,
      })
      if (error) throw error
    }, 'Request submitted. We will review it shortly.')
    if (done) onDone()
  }
  return (
    <Modal title="New project request" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project title"><input className="input" required maxLength={160} value={f.title} onChange={set('title')} /></Field>
        <Field label="Service"><select className="input" value={f.service_type} onChange={set('service_type')}>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Description"><textarea className="input" required rows={4} maxLength={4000} value={f.description} onChange={set('description')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location"><input className="input" maxLength={200} value={f.location} onChange={set('location')} /></Field>
          <Field label="Budget range (optional)"><input className="input" maxLength={80} value={f.budget_range} onChange={set('budget_range')} /></Field>
        </div>
        <Field label="Preferred start date"><input className="input" type="date" value={f.preferred_start} onChange={set('preferred_start')} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Submit request</button></div>
      </form>
    </Modal>
  )
}
