import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthContext'
import { Async, EmptyState, Field, PageHeader, Table, ok, useQuery } from '../../components/ui'
import { date, ghs, label } from '../../lib/format'
import { exportCsv, exportPdf, type Col } from '../../lib/export'

type R = Record<string, unknown> & { id: string }
type Def = { id: string; title: string; finance?: boolean; ranged?: boolean; load: (from: string, to: string) => PromiseLike<R[]>; cols: Col<R>[] }
const s = (v: unknown) => (v == null ? '' : String(v))
const inRange = (q: any, col: string, from: string, to: string) => { if (from) q = q.gte(col, from); if (to) q = q.lte(col, to + 'T23:59:59'); return q }
const name = (o: any) => o?.profiles?.full_name || o?.company_name || ''

const REPORTS: Def[] = [
  { id: 'registrations', title: 'Client registrations', ranged: true,
    load: async (f, t) => ok(await inRange(supabase.from('clients').select('id, company_name, created_at, profiles!inner(full_name, email, phone, status)').order('created_at', { ascending: false }), 'created_at', f, t)) as R[],
    cols: [{ header: 'Name', get: (r) => name(r) }, { header: 'Email', get: (r: any) => r.profiles.email }, { header: 'Phone', get: (r: any) => s(r.profiles.phone) }, { header: 'Company', get: (r) => s(r.company_name) }, { header: 'Status', get: (r: any) => label(r.profiles.status) }, { header: 'Registered', get: (r) => date(s(r.created_at)) }] },
  { id: 'active', title: 'Active projects',
    load: async () => ok(await supabase.from('projects').select('id, code, title, status, progress, start_date, estimated_completion, clients(company_name, profiles(full_name))').eq('status', 'active').eq('archived', false).order('title')) as R[],
    cols: [{ header: 'Code', get: (r) => s(r.code) }, { header: 'Project', get: (r) => s(r.title) }, { header: 'Client', get: (r: any) => name(r.clients) }, { header: 'Progress', get: (r) => s(r.progress) + '%' }, { header: 'Started', get: (r) => date(s(r.start_date)) }, { header: 'ETA', get: (r) => date(s(r.estimated_completion)) }] },
  { id: 'completed', title: 'Completed projects', ranged: true,
    load: async (f, t) => ok(await inRange(supabase.from('projects').select('id, code, title, completed_at, start_date, clients(company_name, profiles(full_name))').eq('status', 'completed').order('completed_at', { ascending: false }), 'completed_at', f, t)) as R[],
    cols: [{ header: 'Code', get: (r) => s(r.code) }, { header: 'Project', get: (r) => s(r.title) }, { header: 'Client', get: (r: any) => name(r.clients) }, { header: 'Started', get: (r) => date(s(r.start_date)) }, { header: 'Completed', get: (r) => date(s(r.completed_at)) }] },
  { id: 'requests', title: 'Pending requests',
    load: async () => ok(await supabase.from('project_requests').select('id, title, service_type, status, created_at, clients(company_name, profiles(full_name))').in('status', ['submitted', 'under_review']).order('created_at')) as R[],
    cols: [{ header: 'Request', get: (r) => s(r.title) }, { header: 'Service', get: (r) => s(r.service_type) }, { header: 'Client', get: (r: any) => name(r.clients) }, { header: 'Status', get: (r) => label(s(r.status)) }, { header: 'Submitted', get: (r) => date(s(r.created_at)) }] },
  { id: 'performance', title: 'Project performance',
    load: async () => ok(await supabase.from('projects').select('id, code, title, status, progress, start_date, estimated_completion, completed_at, clients(company_name, profiles(full_name))').eq('archived', false).order('title')) as R[],
    cols: [{ header: 'Project', get: (r) => `${s(r.code)} ${s(r.title)}` }, { header: 'Client', get: (r: any) => name(r.clients) }, { header: 'Status', get: (r) => label(s(r.status)) }, { header: 'Progress', get: (r) => s(r.progress) + '%' }, { header: 'ETA', get: (r) => date(s(r.estimated_completion)) },
      { header: 'Schedule', get: (r) => (r.status === 'completed' ? (r.completed_at && r.estimated_completion && String(r.completed_at).slice(0, 10) > String(r.estimated_completion) ? 'Finished late' : 'Finished on time') : r.estimated_completion && String(r.estimated_completion) < new Date().toISOString().slice(0, 10) && r.status !== 'cancelled' ? 'Overdue' : 'On track') }] },
  { id: 'transactions', title: 'Financial transactions', finance: true, ranged: true,
    load: async (f, t) => ok(await inRange(supabase.from('payments').select('id, receipt_number, amount, method, reference, status, paid_at, created_at, invoices(number), clients(company_name, profiles(full_name))').order('paid_at', { ascending: false }), 'created_at', f, t)) as R[],
    cols: [{ header: 'Receipt', get: (r) => s(r.receipt_number) }, { header: 'Date', get: (r) => date(s(r.paid_at)) }, { header: 'Client', get: (r: any) => name(r.clients) }, { header: 'Invoice', get: (r: any) => s(r.invoices?.number) }, { header: 'Method', get: (r) => label(s(r.method)) }, { header: 'Amount', get: (r) => ghs(r.amount as number) }, { header: 'Status', get: (r) => label(s(r.status)) }] },
  { id: 'outstanding', title: 'Outstanding payments', finance: true,
    load: async () => ok(await supabase.from('invoices').select('id, number, due_date, total, amount_paid, status, clients(company_name, profiles(full_name))').in('status', ['issued', 'partially_paid', 'overdue']).order('due_date')) as R[],
    cols: [{ header: 'Client', get: (r: any) => name(r.clients) }, { header: 'Invoice', get: (r) => s(r.number) }, { header: 'Due', get: (r) => date(s(r.due_date)) }, { header: 'Total', get: (r) => ghs(r.total as number) }, { header: 'Paid', get: (r) => ghs(r.amount_paid as number) }, { header: 'Balance', get: (r) => ghs(Number(r.total) - Number(r.amount_paid)) }, { header: 'Status', get: (r) => label(s(r.status)) }] },
]

export default function AdminReports() {
  const { role } = useAuth()
  const fin = role === 'super_admin' || role === 'admin' || role === 'accountant'
  const ops = role !== 'accountant'
  const list = REPORTS.filter((r) => (r.finance ? fin : ops || r.id === 'performance'))
  const [id, setId] = useState(list[0]?.id ?? '')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const def = list.find((r) => r.id === id)
  const q = useQuery(async () => (def ? def.load(from, to) : []), [id, from, to])
  return (
    <>
      <PageHeader title="Reports" sub="Run a report, then export it as CSV or PDF." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Report"><select className="input" value={id} onChange={(e) => setId(e.target.value)}>{list.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
        {def?.ranged && <><Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        {def && q.data && <div className="ml-auto flex gap-2 pb-0.5"><button className="btn-ghost" disabled={!q.data.length} onClick={() => exportCsv(def.id, def.cols, q.data!)}>Export CSV</button><button className="btn-primary" disabled={!q.data.length} onClick={() => exportPdf(def.id, def.title, def.cols, q.data!, from || to ? `${from || '…'} to ${to || '…'}` : undefined)}>Export PDF</button></div>}
      </div>
      {!def ? <EmptyState title="No reports available for your role" /> : (
        <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No records for this report" text="Try a wider date range." />}>{(rows) => (<>
          <p className="mb-2 text-sm text-gray-600">{rows.length} record{rows.length === 1 ? '' : 's'}</p>
          <Table rows={rows} cols={def.cols.map((c) => ({ header: c.header, cell: (r: R) => c.get(r) }))} /></>)}</Async>)}
    </>
  )
}
