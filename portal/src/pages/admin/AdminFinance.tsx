import { useMemo, useState, type FormEvent } from 'react'
import { Ban, Banknote, Download, FileCheck2, Plus, Trash2, Undo2, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, Field, Modal, PageHeader, SearchBox, Select, StatCard, Table, Tabs, matches, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { clean, date, ghs, label, num } from '../../lib/format'
import { exportCsv, exportPdf, receiptPdf, type Col } from '../../lib/export'
import type { Client, Deposit, Invoice, LedgerEntry, Payment } from '../../lib/types'

type Inv = Invoice & { clients: { company_name: string | null; profiles: { full_name: string } } | null }
type Pay = Payment & { clients: { profiles: { full_name: string } } | null }
type Onl = { note: string | null; id: string; reference: string; amount: number; commission: number; fees: number | null; channel: string | null; status: string; settled_as: string | null; created_at: string; paid_at: string | null; clients: { company_name: string | null; profiles: { full_name: string } } | null; invoices: { number: string } | null }
type Dep = Deposit & { clients: { company_name: string | null; profiles: { full_name: string } } | null }
type Led = LedgerEntry & { clients: { profiles: { full_name: string } } | null }
const cname = (c: { company_name?: string | null; profiles?: { full_name: string } } | null | undefined) => c?.profiles?.full_name || c?.company_name || '—'
const owed = (i: Invoice) => Number(i.total) - Number(i.amount_paid)

export default function AdminFinance() {
  const [tab, setTab] = useState('invoices')
  const q = useQuery(async () => {
    const [i, p, l, c, set, dp, op] = await Promise.all([
      supabase.from('invoices').select('*, clients(company_name, profiles(full_name))').order('created_at', { ascending: false }),
      supabase.from('payments').select('*, invoices(number), clients(profiles(full_name))').order('paid_at', { ascending: false }),
      supabase.from('ledger_entries').select('*, ledger_accounts(code, name), clients(profiles(full_name))').order('created_at', { ascending: true }),
      supabase.from('clients').select('id, company_name, profiles!inner(full_name, status)').eq('profiles.status', 'active'),
      supabase.from('app_settings').select('value').eq('key', 'system').maybeSingle(),
      supabase.from('deposits').select('*, clients(company_name, profiles(full_name))').order('paid_at', { ascending: false }),
      supabase.from('online_payments').select('*, clients(company_name, profiles(full_name)), invoices(number)').order('created_at', { ascending: false }).limit(300),
    ])
    return { onl: ok(op) as unknown as Onl[], dep: ok(dp) as unknown as Dep[], inv: ok(i) as unknown as Inv[], pay: ok(p) as unknown as Pay[], led: ok(l) as unknown as Led[], clients: ok(c) as unknown as (Client & { profiles: { full_name: string } })[], sys: (set.data?.value ?? { invoice_due_days: 14, tax_rate_percent: 0 }) as { invoice_due_days: number; tax_rate_percent: number } }
  }, [])
  return (
    <>
      <PageHeader title="Finance" sub="Invoices, payments, receipts and the client ledger. Every transaction is audited." />
      <Async q={q}>{(d) => {
        const outstanding = d.inv.filter((i) => ['issued', 'partially_paid', 'overdue'].includes(i.status)).reduce((s, i) => s + owed(i), 0)
        // Cash actually received: real payments plus deposits. Credit applied to an invoice is not new cash.
        const received = d.pay.filter((p) => p.status === 'confirmed' && p.method !== 'account_credit').reduce((s, p) => s + Number(p.amount), 0)
          + d.dep.filter((x) => x.status === 'confirmed').reduce((s, x) => s + Number(x.amount), 0)
        const credit: Record<string, number> = {}
        d.led.forEach((e) => { if (e.account_code === '2100' && e.client_id) credit[e.client_id] = Math.round(((credit[e.client_id] ?? 0) + Number(e.credit) - Number(e.debit)) * 100) / 100 })
        const held = Object.values(credit).reduce((s, v) => s + v, 0)
        return (<>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Outstanding" value={ghs(outstanding)} icon={<Banknote size={20} />} tone={outstanding ? 'red' : 'green'} />
            <StatCard label="Cash received" value={ghs(received)} icon={<FileCheck2 size={20} />} />
            <StatCard label="Client credit held" value={ghs(held)} icon={<Wallet size={20} />} tone="grey" />
            <StatCard label="Overdue invoices" value={d.inv.filter((i) => i.status === 'overdue').length} icon={<Ban size={20} />} tone="gold" />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices', count: d.inv.length }, { id: 'payments', label: 'Payments', count: d.pay.length }, { id: 'credit', label: 'Account credit', count: d.dep.length }, { id: 'online', label: 'Online payments', count: d.onl.length }, { id: 'outstanding', label: 'Outstanding' }, { id: 'ledger', label: 'Ledger' }, { id: 'statements', label: 'Statements' }]} />
          {tab === 'invoices' && <Invoices d={{ ...d, credit }} reload={q.reload} />}
          {tab === 'payments' && <Payments pay={d.pay} reload={q.reload} />}
          {tab === 'credit' && <Credit dep={d.dep} credit={credit} clients={d.clients} reload={q.reload} />}
          {tab === 'online' && <Online rows={d.onl} reload={q.reload} />}
          {tab === 'outstanding' && <Outstanding inv={d.inv} />}
          {tab === 'ledger' && <Ledger led={d.led} />}
          {tab === 'statements' && <Statements led={d.led} clients={d.clients} />}
        </>)
      }}</Async>
    </>
  )
}

type D = { inv: Inv[]; clients: (Client & { profiles: { full_name: string } })[]; sys: { invoice_due_days: number; tax_rate_percent: number }; credit: Record<string, number> }
function Invoices({ d, reload }: { d: D; reload: () => void }) {
  const [s, setS] = useState(''); const [st, setSt] = useState('all'); const [form, setForm] = useState<Inv | 'new' | null>(null); const [pay, setPay] = useState<Inv | null>(null); const [apply, setApply] = useState<Inv | null>(null)
  const { run } = useAction(); const { confirm } = useFeedback()
  const rpc = (fn: string, args: Record<string, unknown>, msg: string) => run(async () => { ok(await supabase.rpc(fn, args)) }, msg).then(() => reload())
  const cols: Col<Inv>[] = [{ header: 'Invoice', get: (i) => i.number }, { header: 'Client', get: (i) => cname(i.clients) }, { header: 'Issued', get: (i) => date(i.issue_date) }, { header: 'Due', get: (i) => date(i.due_date) }, { header: 'Total', get: (i) => ghs(i.total) }, { header: 'Paid', get: (i) => ghs(i.amount_paid) }, { header: 'Balance', get: (i) => ghs(owed(i)) }, { header: 'Status', get: (i) => label(i.status) }]
  const rows = d.inv.filter((i) => (st === 'all' || i.status === st) && matches(s, i.number, cname(i.clients)))
  return (<>
    <div className="mb-3 flex flex-wrap items-center gap-2"><SearchBox value={s} onChange={setS} placeholder="Search invoices" /><Select value={st} onChange={setSt} options={['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void']} all="All statuses" />
      <div className="ml-auto flex gap-2"><button className="btn-ghost" onClick={() => exportCsv('invoices', cols, rows)}>CSV</button><button className="btn-ghost" onClick={() => exportPdf('invoices', 'Invoices', cols, rows)}>PDF</button><button className="btn-primary" onClick={() => setForm('new')}><Plus size={15} />New invoice</button></div></div>
    <Table rows={rows} cols={[
      { header: 'Invoice', cell: (i) => <b>{i.number}</b> }, { header: 'Client', cell: (i) => cname(i.clients) }, { header: 'Due', cell: (i) => date(i.due_date) },
      { header: 'Total', cell: (i) => ghs(i.total) }, { header: 'Balance', cell: (i) => ghs(owed(i)) }, { header: 'Status', cell: (i) => <Badge s={i.status} /> },
      { header: 'Actions', cell: (i) => <div className="flex flex-wrap gap-1">
        {i.status === 'draft' && <><button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setForm(i)}>Edit</button>
          <button className="btn-primary !px-2 !py-1 text-xs" onClick={async () => { if (await confirm({ title: `Issue ${i.number}?`, text: 'The client is notified and the invoice is locked.', action: 'Issue' })) rpc('issue_invoice', { p_invoice: i.id }, 'Invoice issued') }}>Issue</button>
          <button className="p-1 text-gray-500 hover:text-red-600" aria-label="Delete draft" onClick={async () => { if (await confirm({ title: `Delete draft ${i.number}?`, action: 'Delete', danger: true })) run(async () => { ok(await supabase.from('invoices').delete().eq('id', i.id)) }, 'Draft deleted').then(reload) }}><Trash2 size={14} /></button></>}
        {['issued', 'partially_paid', 'overdue'].includes(i.status) && <><button className="btn-primary !px-2 !py-1 text-xs" onClick={() => setPay(i)}>Record payment</button>
          {(d.credit[i.client_id] ?? 0) > 0 && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setApply(i)}><Wallet size={13} />Apply credit</button>}
          {Number(i.amount_paid) === 0 && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={async () => { if (await confirm({ title: `Void ${i.number}?`, text: 'A reversing ledger entry is posted.', action: 'Void', danger: true })) rpc('void_invoice', { p_invoice: i.id }, 'Invoice voided') }}>Void</button>}</>}
      </div> },
    ]} />
    {form && <InvoiceForm inv={form === 'new' ? null : form} d={d} onClose={() => setForm(null)} onDone={() => { setForm(null); reload() }} />}
    {pay && <PayForm inv={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload() }} />}
    {apply && <ApplyCreditForm inv={apply} available={d.credit[apply.client_id] ?? 0} onClose={() => setApply(null)} onDone={() => { setApply(null); reload() }} />}
  </>)
}

type Line = { description: string; quantity: string; unit_price: string }
function InvoiceForm({ inv, d, onClose, onDone }: { inv: Inv | null; d: D; onClose: () => void; onDone: () => void }) {
  const [client, setClient] = useState(inv?.client_id ?? ''); const [product, setProduct] = useState(inv?.product ?? ''); const [notes, setNotes] = useState(inv?.notes ?? '')
  const [due, setDue] = useState(inv?.due_date ?? new Date(Date.now() + d.sys.invoice_due_days * 864e5).toISOString().slice(0, 10))
  const [lines, setLines] = useState<Line[]>(inv?.line_items?.length ? inv.line_items.map((l) => ({ description: l.description, quantity: String(l.quantity), unit_price: String(l.unit_price) })) : [{ description: '', quantity: '1', unit_price: '' }])
  const { run, busy } = useAction()
  const subtotal = useMemo(() => lines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0), [lines])
  const tax = Math.round(subtotal * d.sys.tax_rate_percent) / 100; const total = Math.round((subtotal + tax) * 100) / 100
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, x) => (x === i ? { ...l, [k]: v } : l)))
  const submit = async (e: FormEvent) => { e.preventDefault()
    const items = lines.filter((l) => l.description.trim()).map((l) => ({ description: clean(l.description).slice(0, 200), quantity: num(l.quantity), unit_price: num(l.unit_price) }))
    if (!items.length) return alert('Add at least one line item.')
    const sub = Math.round(items.reduce((s, l) => s + l.quantity * l.unit_price, 0) * 100) / 100; const tx = Math.round(sub * d.sys.tax_rate_percent) / 100
    const body = { client_id: client, due_date: due || null, line_items: items, subtotal: sub, tax: tx, total: Math.round((sub + tx) * 100) / 100, notes: clean(notes) || null, product: clean(product).slice(0, 80) || null }
    const r = await run(async () => { const x = inv ? await supabase.from('invoices').update(body).eq('id', inv.id) : await supabase.from('invoices').insert(body); if (x.error) throw x.error }, inv ? 'Draft saved' : 'Draft created'); if (r) onDone() }
  return <Modal title={inv ? `Edit ${inv.number}` : 'New invoice'} onClose={onClose} wide><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Client"><select className="input" required disabled={!!inv} value={client} onChange={(e) => setClient(e.target.value)}><option value="">Select client…</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.profiles.full_name}</option>)}</select></Field>
      <Field label="Due date"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field label="Product / service" hint="Optional. Used to work out agent commission when the client was referred by an agent."><input className="input" maxLength={80} list="inv-products" value={product} onChange={(e) => setProduct(e.target.value)} /><datalist id="inv-products">{['Building construction', 'Block supply', 'Solar installation', 'Land purchase', 'Property'].map((x) => <option key={x} value={x} />)}</datalist></Field></div>
    <div className="space-y-2"><p className="text-sm font-semibold text-gray-700">Line items (GHS)</p>
      {lines.map((l, i) => <div key={i} className="grid grid-cols-[1fr_4.5rem_6.5rem_auto] items-center gap-2"><input className="input" placeholder="Description" maxLength={200} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /><input className="input" type="number" min="0" step="any" aria-label="Quantity" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /><input className="input" type="number" min="0" step="0.01" placeholder="Price" aria-label="Unit price" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} />
        <button type="button" className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, x) => x !== i) : lines)}><Trash2 size={15} /></button></div>)}
      <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setLines([...lines, { description: '', quantity: '1', unit_price: '' }])}><Plus size={13} />Add line</button></div>
    <div className="ml-auto max-w-xs space-y-1 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{ghs(subtotal)}</span></div><div className="flex justify-between"><span>Tax ({d.sys.tax_rate_percent}%)</span><span>{ghs(tax)}</span></div><div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{ghs(total)}</span></div></div>
    <Field label="Notes (shown on the invoice)"><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !client}>Save as draft</button></div></form></Modal>
}
function PayForm({ inv, onClose, onDone }: { inv: Inv; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(owed(inv))); const [method, setMethod] = useState('bank_transfer'); const [ref, setRef] = useState(''); const [paid, setPaid] = useState(new Date().toISOString().slice(0, 10)); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault(); const r = await run(async () => { ok(await supabase.rpc('record_payment', { p_invoice: inv.id, p_amount: num(amount), p_method: method, p_reference: clean(ref) || null, p_paid_at: paid })) }, 'Payment recorded'); if (r) onDone() }
  return <Modal title={`Record payment · ${inv.number}`} onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <p className="text-sm text-gray-600">Client: <b>{cname(inv.clients)}</b> · Outstanding: <b>{ghs(owed(inv))}</b></p>
    <Field label="Amount (GHS)"><input className="input" type="number" required min="0.01" max={owed(inv)} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field><Field label="Date received"><input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={paid} onChange={(e) => setPaid(e.target.value)} /></Field></div>
    <Field label="Reference"><input className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
    <p className="text-xs text-gray-500">This records a payment already received. No money is moved by the portal.</p>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Record payment</button></div></form></Modal>
}

function Payments({ pay, reload }: { pay: Pay[]; reload: () => void }) {
  const [s, setS] = useState(''); const { run } = useAction(); const [rev, setRev] = useState<Pay | null>(null); const [reason, setReason] = useState('')
  const rows = pay.filter((p) => matches(s, p.receipt_number, cname(p.clients), p.reference))
  const cols: Col<Pay>[] = [{ header: 'Receipt', get: (p) => p.receipt_number }, { header: 'Date', get: (p) => date(p.paid_at) }, { header: 'Client', get: (p) => cname(p.clients) }, { header: 'Invoice', get: (p) => p.invoices?.number ?? '' }, { header: 'Method', get: (p) => label(p.method) }, { header: 'Reference', get: (p) => p.reference ?? '' }, { header: 'Amount', get: (p) => ghs(p.amount) }, { header: 'Status', get: (p) => label(p.status) }]
  return (<>
    <div className="mb-3 flex flex-wrap gap-2"><SearchBox value={s} onChange={setS} placeholder="Search payments" /><div className="ml-auto flex gap-2"><button className="btn-ghost" onClick={() => exportCsv('payments', cols, rows)}>CSV</button><button className="btn-ghost" onClick={() => exportPdf('payments', 'Payments received', cols, rows)}>PDF</button></div></div>
    <Table rows={rows} cols={[{ header: 'Receipt', cell: (p) => <b>{p.receipt_number}</b> }, { header: 'Date', cell: (p) => date(p.paid_at) }, { header: 'Client', cell: (p) => cname(p.clients) }, { header: 'Invoice', cell: (p) => p.invoices?.number }, { header: 'Amount', cell: (p) => ghs(p.amount) }, { header: 'Status', cell: (p) => <Badge s={p.status} /> },
      { header: '', cell: (p) => <div className="flex gap-1"><button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => receiptPdf({ number: p.receipt_number, client: cname(p.clients), invoice: p.invoices?.number ?? '', amount: ghs(p.amount), method: p.method, date: date(p.paid_at), reference: p.reference })}><Download size={13} />Receipt</button>
        {p.status === 'confirmed' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setRev(p); setReason('') }}><Undo2 size={13} />Reverse</button>}</div> }]} />
    {rev && <Modal title={`Reverse ${rev.receipt_number}`} onClose={() => setRev(null)} small><Field label="Reason (recorded in the audit trail)"><textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setRev(null)}>Cancel</button><button className="btn-danger" disabled={!reason.trim()} onClick={async () => { const r = await run(async () => { ok(await supabase.rpc('reverse_payment', { p_payment: rev.id, p_reason: clean(reason) })) }, 'Payment reversed'); if (r) { setRev(null); reload() } }}>Reverse payment</button></div></Modal>}
  </>)
}

function Outstanding({ inv }: { inv: Inv[] }) {
  const rows = inv.filter((i) => ['issued', 'partially_paid', 'overdue'].includes(i.status)).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const cols: Col<Inv>[] = [{ header: 'Client', get: (i) => cname(i.clients) }, { header: 'Invoice', get: (i) => i.number }, { header: 'Due', get: (i) => date(i.due_date) }, { header: 'Total', get: (i) => ghs(i.total) }, { header: 'Paid', get: (i) => ghs(i.amount_paid) }, { header: 'Balance', get: (i) => ghs(owed(i)) }, { header: 'Status', get: (i) => label(i.status) }]
  return (<><div className="mb-3 flex items-center justify-between"><p className="text-sm text-gray-600">Total outstanding: <b>{ghs(rows.reduce((s, i) => s + owed(i), 0))}</b></p><div className="flex gap-2"><button className="btn-ghost" onClick={() => exportCsv('outstanding', cols, rows)}>CSV</button><button className="btn-ghost" onClick={() => exportPdf('outstanding', 'Outstanding balances', cols, rows)}>PDF</button></div></div>
    <Table rows={rows} cols={[{ header: 'Client', cell: (i) => cname(i.clients) }, { header: 'Invoice', cell: (i) => <b>{i.number}</b> }, { header: 'Due', cell: (i) => date(i.due_date) }, { header: 'Balance', cell: (i) => ghs(owed(i)) }, { header: 'Status', cell: (i) => <Badge s={i.status} /> }]} /></>)
}

function Ledger({ led }: { led: Led[] }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const rows = led.filter((e) => (!from || e.created_at.slice(0, 10) >= from) && (!to || e.created_at.slice(0, 10) <= to)).slice().reverse()
  const dr = rows.reduce((s, e) => s + Number(e.debit), 0); const cr = rows.reduce((s, e) => s + Number(e.credit), 0)
  const cols: Col<Led>[] = [{ header: 'Date', get: (e) => date(e.created_at) }, { header: 'Account', get: (e) => `${e.ledger_accounts?.code} ${e.ledger_accounts?.name}` }, { header: 'Client', get: (e) => cname(e.clients) }, { header: 'Description', get: (e) => e.description }, { header: 'Debit', get: (e) => Number(e.debit) || '' }, { header: 'Credit', get: (e) => Number(e.credit) || '' }]
  return (<><div className="mb-3 flex flex-wrap items-end gap-2"><Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    <p className="pb-2 text-sm text-gray-600">Debits <b>{ghs(dr)}</b> · Credits <b>{ghs(cr)}</b></p><div className="ml-auto flex gap-2 pb-0.5"><button className="btn-ghost" onClick={() => exportCsv('ledger', cols, rows)}>CSV</button><button className="btn-ghost" onClick={() => exportPdf('ledger', 'General ledger', cols, rows)}>PDF</button></div></div>
    <Table rows={rows} cols={[{ header: 'Date', cell: (e) => date(e.created_at) }, { header: 'Account', cell: (e) => <span className="text-xs">{e.ledger_accounts?.code} {e.ledger_accounts?.name}</span> }, { header: 'Client', cell: (e) => cname(e.clients) }, { header: 'Description', cell: (e) => e.description }, { header: 'Debit', cell: (e) => (Number(e.debit) ? ghs(e.debit) : '') }, { header: 'Credit', cell: (e) => (Number(e.credit) ? ghs(e.credit) : '') }]} /></>)
}

function Statements({ led, clients }: { led: Led[]; clients: (Client & { profiles: { full_name: string } })[] }) {
  const [cid, setCid] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const all = led.filter((e) => e.client_id === cid && e.ledger_accounts?.code === '1100')
  let bal = all.filter((e) => from && e.created_at.slice(0, 10) < from).reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0)
  const opening = bal
  const rows = all.filter((e) => (!from || e.created_at.slice(0, 10) >= from) && (!to || e.created_at.slice(0, 10) <= to)).map((e) => ({ ...e, balance: (bal += Number(e.debit) - Number(e.credit)) }))
  const name = clients.find((c) => c.id === cid)?.profiles.full_name ?? ''
  const cols: Col<(typeof rows)[number]>[] = [{ header: 'Date', get: (e) => date(e.created_at) }, { header: 'Description', get: (e) => e.description }, { header: 'Charges', get: (e) => (Number(e.debit) ? ghs(e.debit) : '') }, { header: 'Payments', get: (e) => (Number(e.credit) ? ghs(e.credit) : '') }, { header: 'Balance', get: (e) => ghs(e.balance) }]
  return (<><div className="mb-3 flex flex-wrap items-end gap-2"><Field label="Client"><select className="input" value={cid} onChange={(e) => setCid(e.target.value)}><option value="">Select client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.profiles.full_name}</option>)}</select></Field>
    <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    {cid && <div className="ml-auto flex gap-2 pb-0.5"><button className="btn-ghost" onClick={() => exportCsv(`statement-${name}`, cols, rows)}>CSV</button><button className="btn-primary" onClick={() => exportPdf(`statement-${name}`, 'Account statement', cols, rows, `${name} · opening balance ${ghs(opening)} · closing ${ghs(bal)}`)}>PDF</button></div>}</div>
    {!cid ? <p className="py-8 text-center text-sm text-gray-500">Choose a client to generate a statement.</p> : <><p className="mb-2 text-sm text-gray-600">Opening balance <b>{ghs(opening)}</b> · Closing balance <b>{ghs(bal)}</b></p>
      <Table rows={rows} cols={[{ header: 'Date', cell: (e) => date(e.created_at) }, { header: 'Description', cell: (e) => e.description }, { header: 'Charges', cell: (e) => (Number(e.debit) ? ghs(e.debit) : '') }, { header: 'Payments', cell: (e) => (Number(e.credit) ? ghs(e.credit) : '') }, { header: 'Balance', cell: (e) => <b>{ghs(e.balance)}</b> }]} /></>}</>)
}

function ApplyCreditForm({ inv, available, onClose, onDone }: { inv: Inv; available: number; onClose: () => void; onDone: () => void }) {
  const max = Math.min(available, owed(inv)); const [amount, setAmount] = useState(String(max)); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault(); const r = await run(async () => { ok(await supabase.rpc('apply_credit', { p_invoice: inv.id, p_amount: num(amount) })) }, 'Credit applied'); if (r) onDone() }
  return <Modal title={`Apply account credit · ${inv.number}`} onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <p className="text-sm text-gray-600">Client: <b>{cname(inv.clients)}</b><br />Invoice balance: <b>{ghs(owed(inv))}</b> · Credit available: <b>{ghs(available)}</b></p>
    <Field label="Amount to apply (GHS)"><input className="input" type="number" required min="0.01" max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
    <p className="text-xs text-gray-500">The credit is moved onto this invoice and a receipt is created. The client is notified.</p>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || num(amount) <= 0 || num(amount) > max + 0.001}>Apply credit</button></div></form></Modal>
}

function Credit({ dep, credit, clients, reload }: { dep: Dep[]; credit: Record<string, number>; clients: (Client & { profiles: { full_name: string } })[]; reload: () => void }) {
  const [s, setS] = useState(''); const [form, setForm] = useState<string | null>(null); const [rev, setRev] = useState<Dep | null>(null); const [reason, setReason] = useState(''); const { run } = useAction()
  const holders = clients.filter((c) => (credit[c.id] ?? 0) !== 0 && matches(s, c.profiles.full_name, c.company_name))
  const rows = dep.filter((x) => matches(s, x.receipt_number, cname(x.clients), x.reference))
  const cols: Col<Dep>[] = [{ header: 'Receipt', get: (x) => x.receipt_number }, { header: 'Date', get: (x) => date(x.paid_at) }, { header: 'Client', get: (x) => cname(x.clients) }, { header: 'Method', get: (x) => label(x.method) }, { header: 'Reference', get: (x) => x.reference ?? '' }, { header: 'Amount', get: (x) => ghs(x.amount) }, { header: 'Status', get: (x) => label(x.status) }]
  return (<>
    <p className="mb-3 max-w-3xl text-sm text-gray-600">Advance payments are held as account credit. The client cannot withdraw it or transfer it; you apply it to their invoices. Record a deposit only after the money has been received.</p>
    <div className="mb-3 flex flex-wrap items-center gap-2"><SearchBox value={s} onChange={setS} placeholder="Search client or receipt" />
      <div className="ml-auto flex gap-2"><button className="btn-ghost" onClick={() => exportCsv('deposits', cols, rows)}>CSV</button><button className="btn-ghost" onClick={() => exportPdf('deposits', 'Deposits received', cols, rows)}>PDF</button><button className="btn-primary" onClick={() => setForm('')}><Plus size={15} />Record deposit</button></div></div>
    <h3 className="mb-2 text-sm font-semibold text-gray-700">Credit balances</h3>
    <Table rows={holders} cols={[{ header: 'Client', cell: (c) => c.profiles.full_name }, { header: 'Credit available', cell: (c) => <b>{ghs(credit[c.id] ?? 0)}</b> }, { header: '', cell: (c) => <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setForm(c.id)}>Add deposit</button> }]} />
    <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Deposits</h3>
    <Table rows={rows} cols={[{ header: 'Receipt', cell: (x) => <b>{x.receipt_number}</b> }, { header: 'Date', cell: (x) => date(x.paid_at) }, { header: 'Client', cell: (x) => cname(x.clients) }, { header: 'Method', cell: (x) => label(x.method) }, { header: 'Amount', cell: (x) => ghs(x.amount) }, { header: 'Status', cell: (x) => <Badge s={x.status} /> },
      { header: '', cell: (x) => <div className="flex gap-1"><button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => receiptPdf({ number: x.receipt_number, client: cname(x.clients), invoice: 'Account credit deposit', amount: ghs(x.amount), method: x.method, date: date(x.paid_at), reference: x.reference })}><Download size={13} />Receipt</button>
        {x.status === 'confirmed' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setRev(x); setReason('') }}><Undo2 size={13} />Reverse</button>}</div> }]} />
    {form !== null && <DepositForm clients={clients} start={form} onClose={() => setForm(null)} onDone={() => { setForm(null); reload() }} />}
    {rev && <Modal title={`Reverse ${rev.receipt_number}`} onClose={() => setRev(null)} small><p className="mb-3 text-sm text-gray-600">Only possible while the client still has this much credit unused. If it was already applied to invoices, reverse those payments first.</p><Field label="Reason (recorded in the audit trail)"><textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setRev(null)}>Cancel</button><button className="btn-danger" disabled={!reason.trim()} onClick={async () => { const r = await run(async () => { ok(await supabase.rpc('reverse_deposit', { p_deposit: rev.id, p_reason: clean(reason) })) }, 'Deposit reversed'); if (r) { setRev(null); reload() } }}>Reverse deposit</button></div></Modal>}
  </>)
}

function DepositForm({ clients, start, onClose, onDone }: { clients: (Client & { profiles: { full_name: string } })[]; start: string; onClose: () => void; onDone: () => void }) {
  const [client, setClient] = useState(start); const [amount, setAmount] = useState(''); const [method, setMethod] = useState('bank_transfer'); const [ref, setRef] = useState(''); const [paid, setPaid] = useState(new Date().toISOString().slice(0, 10)); const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault(); const r = await run(async () => { ok(await supabase.rpc('record_deposit', { p_client: client, p_amount: num(amount), p_method: method, p_reference: clean(ref) || null, p_paid_at: paid })) }, 'Deposit recorded'); if (r) onDone() }
  return <Modal title="Record deposit" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Client"><select className="input" required value={client} onChange={(e) => setClient(e.target.value)}><option value="">Select client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.profiles.full_name}</option>)}</select></Field>
    <Field label="Amount (GHS)"><input className="input" type="number" required min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></Field><Field label="Date received"><input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={paid} onChange={(e) => setPaid(e.target.value)} /></Field></div>
    <Field label="Reference"><input className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
    <p className="text-xs text-gray-500">This records money already received. It is held as the client's account credit and a receipt is created. No money is moved by the portal.</p>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !client || num(amount) <= 0}>Record deposit</button></div></form></Modal>
}

function Online({ rows, reload }: { rows: Onl[]; reload: () => void }) {
  const { run, busy } = useAction()
  const recheck = (ref: string) => run(async () => { const { data, error } = await supabase.functions.invoke('paystack-payments', { body: { action: 'verify', reference: ref } }); if (error) throw error; const st = (data as { status?: string }).status; if (st === 'network') throw new Error('Could not reach Paystack. Try again shortly.') }, 'Status refreshed').then(reload)
  const done = rows.filter((r) => r.status === 'success')
  const commission = done.reduce((s, r) => s + Number(r.commission), 0); const fees = done.reduce((s, r) => s + Number(r.fees ?? 0), 0)
  return (<>
    <p className="mb-3 max-w-3xl text-sm text-gray-600">Card and mobile money payments made through Paystack. Successful payments are recorded against the invoice automatically. Refunds are made in the Paystack dashboard.</p>
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><StatCard label="Paid online" value={ghs(done.reduce((s, r) => s + Number(r.amount), 0))} icon={<Banknote size={20} />} /><StatCard label="Commission (Crestonic)" value={ghs(commission)} tone="grey" icon={<Wallet size={20} />} /><StatCard label="Paystack fees" value={ghs(fees)} tone="grey" icon={<FileCheck2 size={20} />} /></div>
    <Table rows={rows} cols={[{ header: 'Date', cell: (r) => date(r.paid_at ?? r.created_at) }, { header: 'Client', cell: (r) => cname(r.clients) }, { header: 'Invoice', cell: (r) => r.invoices?.number ?? '' }, { header: 'Amount', cell: (r) => ghs(r.amount) }, { header: 'Commission', cell: (r) => ghs(r.commission) }, { header: 'Channel', cell: (r) => label(r.channel ?? '') }, { header: 'Status', cell: (r) => <Badge s={r.status === 'initiated' ? 'pending' : r.status} /> }, { header: 'Reference', cell: (r) => <span className="font-mono text-xs">{r.reference}</span> }, { header: 'Note', cell: (r) => <span className="text-xs text-gray-600">{r.note ?? ''}</span> }, { header: '', cell: (r) => r.status === 'initiated' && <button className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={() => recheck(r.reference)}>Check status</button> }]} />
  </>)
}
