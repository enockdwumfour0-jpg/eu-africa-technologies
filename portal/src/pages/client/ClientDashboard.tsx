import { Link } from 'react-router-dom'
import { Activity, Bell, CheckCircle2, FileClock, FolderKanban, Receipt, Rocket } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, PageHeader, StatCard, ok, useQuery } from '../../components/ui'
import { ago, ghs } from '../../lib/format'
import type { Notification } from '../../lib/types'

export default function ClientDashboard() {
  const { session, status } = useAuth()
  const q = useQuery(async () => {
    const [me, projects, reqs, inv, notes, ups] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', session!.user.id).maybeSingle(),
      supabase.from('projects').select('id, status').eq('archived', false),
      supabase.from('project_requests').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']),
      supabase.from('invoices').select('total, amount_paid').in('status', ['issued', 'partially_paid', 'overdue']),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('project_updates').select('id, title, created_at, projects(title)').order('created_at', { ascending: false }).limit(5),
    ])
    const p = ok(projects) as { status: string }[]
    const owing = (ok(inv) as { total: number; amount_paid: number }[]).reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0)
    return {
      name: (me.data?.full_name as string) || '', total: p.length,
      active: p.filter((x) => x.status === 'active').length, done: p.filter((x) => x.status === 'completed').length,
      pending: reqs.count ?? 0, owing, notes: ok(notes) as Notification[],
      ups: ok(ups) as unknown as { id: string; title: string; created_at: string; projects: { title: string } | null }[],
    }
  }, [])
  return (
    <>
      <PageHeader title={`Welcome${q.data?.name ? ', ' + q.data.name.split(' ')[0] : ''}`} sub="Here is an overview of your account with EU-AFRIC Technologies."
        actions={<><span className="flex items-center gap-2 text-sm text-gray-600">Account <Badge s={status ?? 'active'} /></span><Link to="/portal/projects?tab=requests" className="btn-primary">Request a project</Link></>} />
      <Async q={q}>{(d) => (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Total projects" value={d.total} icon={<FolderKanban size={20} />} />
            <StatCard label="Active projects" value={d.active} icon={<Rocket size={20} />} tone="gold" />
            <StatCard label="Completed projects" value={d.done} icon={<CheckCircle2 size={20} />} />
            <StatCard label="Pending requests" value={d.pending} icon={<FileClock size={20} />} tone="grey" />
            <StatCard label="Outstanding invoices" value={ghs(d.owing)} icon={<Receipt size={20} />} tone={d.owing > 0 ? 'red' : 'green'} hint={d.owing > 0 ? 'Balance due' : 'All settled'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Bell size={16} />Recent notifications</h2>
              {d.notes.length === 0 ? <p className="py-4 text-sm text-gray-500">No notifications yet.</p> : <ul className="divide-y">{d.notes.map((n) => (
                <li key={n.id} className="py-2"><p className="text-sm font-semibold">{n.title}</p>{n.body && <p className="line-clamp-1 text-xs text-gray-600">{n.body}</p>}<p className="text-[11px] text-gray-400">{ago(n.created_at)}</p></li>))}</ul>}</section>
            <section className="card"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Activity size={16} />Recent project activity</h2>
              {d.ups.length === 0 ? <p className="py-4 text-sm text-gray-500">Updates from your project team will appear here.</p> : <ul className="divide-y">{d.ups.map((u) => (
                <li key={u.id} className="py-2"><p className="text-sm font-semibold">{u.title}</p><p className="text-xs text-gray-600">{u.projects?.title}</p><p className="text-[11px] text-gray-400">{ago(u.created_at)}</p></li>))}</ul>}</section>
          </div>
        </div>)}</Async>
    </>
  )
}
