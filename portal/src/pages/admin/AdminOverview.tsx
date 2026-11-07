import { Banknote, Briefcase, CheckCircle2, FileClock, Hourglass, Receipt, Rocket, UserCheck, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, PageHeader, StatCard, ok, useQuery } from '../../components/ui'
import { ago, ghs, label } from '../../lib/format'
import { Link } from 'react-router-dom'

const COLORS: Record<string, string> = { planning: '#2563eb', active: '#168447', on_hold: '#F4C430', completed: '#151515', cancelled: '#9ca3af' }

export default function AdminOverview() {
  const { role } = useAuth()
  const fin = role === 'super_admin' || role === 'admin' || role === 'accountant'
  const ops = role === 'super_admin' || role === 'admin' || role === 'support_officer'
  const q = useQuery(async () => {
    const [clients, apps, projects, reqs, inv, pay, acts, dep] = await Promise.all([
      ops || fin ? supabase.from('clients').select('id', { count: 'exact', head: true }) : null,
      ops ? supabase.from('client_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending') : null,
      supabase.from('projects').select('id, status').eq('archived', false),
      ops ? supabase.from('project_requests').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'under_review']) : null,
      fin ? supabase.from('invoices').select('total, amount_paid').in('status', ['issued', 'partially_paid', 'overdue']) : null,
      fin ? supabase.from('payments').select('amount, paid_at').eq('status', 'confirmed').neq('method', 'account_credit') : null,
      supabase.from('project_updates').select('id, title, created_at, projects(title)').order('created_at', { ascending: false }).limit(8),
      fin ? supabase.from('deposits').select('amount, paid_at').eq('status', 'confirmed') : null,
    ])
    const p = ok(projects) as { status: string }[]
    const byStatus = Object.entries(p.reduce<Record<string, number>>((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {})).map(([name, value]) => ({ name, value }))
    const owing = inv ? (ok(inv) as { total: number; amount_paid: number }[]).reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0) : 0
    // cash received = real payments + deposits (credit applied to invoices is not new cash)
    const payments = [...(pay ? (ok(pay) as { amount: number; paid_at: string }[]) : []), ...(dep ? (ok(dep) as { amount: number; paid_at: string }[]) : [])]
    const months: { m: string; total: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      const key = d.toISOString().slice(0, 7)
      months.push({ m: d.toLocaleDateString('en-GB', { month: 'short' }), total: payments.filter((x) => x.paid_at.startsWith(key)).reduce((s, x) => s + Number(x.amount), 0) })
    }
    return {
      clients: clients?.count ?? 0, apps: apps?.count ?? 0, active: p.filter((x) => x.status === 'active').length, done: p.filter((x) => x.status === 'completed').length,
      reqs: reqs?.count ?? 0, owing, received: payments.reduce((s, x) => s + Number(x.amount), 0), byStatus, months,
      acts: ok(acts) as unknown as { id: string; title: string; created_at: string; projects: { title: string } | null }[],
    }
  }, [role])
  return (
    <>
      <PageHeader title="Overview" sub="A snapshot of clients, projects and finances." />
      <Async q={q}>{(d) => (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(ops || fin) && <StatCard label="Total clients" value={d.clients} icon={<Users size={20} />} />}
            {ops && <Link to="/admin/clients"><StatCard label="Pending approvals" value={d.apps} icon={<UserCheck size={20} />} tone={d.apps ? 'gold' : 'grey'} /></Link>}
            <StatCard label="Active projects" value={d.active} icon={<Rocket size={20} />} />
            <StatCard label="Completed projects" value={d.done} icon={<CheckCircle2 size={20} />} tone="grey" />
            {ops && <Link to="/admin/requests"><StatCard label="Pending requests" value={d.reqs} icon={<FileClock size={20} />} tone={d.reqs ? 'gold' : 'grey'} /></Link>}
            {fin && <StatCard label="Outstanding invoices" value={ghs(d.owing)} icon={<Receipt size={20} />} tone={d.owing ? 'red' : 'green'} />}
            {fin && <StatCard label="Payments received" value={ghs(d.received)} icon={<Banknote size={20} />} />}
            {!ops && !fin && <StatCard label="Assigned projects" value={d.active + d.done} icon={<Briefcase size={20} />} />}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card"><h2 className="mb-3 font-semibold">Projects by status</h2>
              {d.byStatus.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">No projects yet.</p> :
                <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={d.byStatus} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} label={(e) => String((e as { value?: number }).value ?? '')}>
                  {d.byStatus.map((s) => <Cell key={s.name} fill={COLORS[s.name] ?? '#9ca3af'} />)}</Pie><Tooltip formatter={(v, n) => [v as number, label(String(n))]} /><Legend formatter={(v) => label(String(v))} /></PieChart></ResponsiveContainer></div>}
            </section>
            {fin ? (
              <section className="card"><h2 className="mb-3 font-semibold">Payments received (last 6 months)</h2>
                <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.months}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="m" /><YAxis width={56} tickFormatter={(v) => (v >= 1000 ? v / 1000 + 'k' : v)} /><Tooltip formatter={(v) => ghs(v as number)} /><Bar dataKey="total" name="Received" fill="#168447" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
            ) : (
              <section className="card"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Hourglass size={16} />Recent activity</h2>
                {d.acts.length === 0 ? <p className="py-6 text-center text-sm text-gray-500">No activity yet.</p> : <ul className="divide-y">{d.acts.map((a) => <li key={a.id} className="py-2 text-sm"><p className="font-semibold">{a.title}</p><p className="text-xs text-gray-500">{a.projects?.title} · {ago(a.created_at)}</p></li>)}</ul>}</section>
            )}
          </div>
          {fin && <section className="card"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Hourglass size={16} />Recent project activity</h2>
            {d.acts.length === 0 ? <p className="py-4 text-center text-sm text-gray-500">No activity yet.</p> : <ul className="grid gap-x-6 sm:grid-cols-2">{d.acts.map((a) => <li key={a.id} className="border-b py-2 text-sm"><p className="font-semibold">{a.title}</p><p className="text-xs text-gray-500">{a.projects?.title} · {ago(a.created_at)}</p></li>)}</ul>}</section>}
        </div>)}</Async>
    </>
  )
}
