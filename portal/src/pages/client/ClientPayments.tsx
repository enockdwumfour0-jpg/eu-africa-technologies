import { useState } from 'react'
import { Download, FileDown, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, PageHeader, StatCard, Table, Tabs, ok, useQuery } from '../../components/ui'
import { date, ghs, label } from '../../lib/format'
import { exportCsv, exportPdf, receiptPdf, type Col } from '../../lib/export'
import type { Invoice, LedgerEntry, Payment } from '../../lib/types'

export default function ClientPayments() {
  const [tab, setTab] = useState('invoices')
  const q = useQuery(async () => {
    const [i, p, l, me] = await Promise.all([
      supabase.from('invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('payments').select('*, invoices(number)').order('paid_at', { ascending: false }),
      supabase.from('ledger_entries').select('*, ledger_accounts(code, name)').order('created_at', { ascending: true }),
      supabase.from('profiles').select('full_name').maybeSingle(),
    ])
    return { inv: ok(i) as Invoice[], pay: ok(p) as unknown as Payment[], led: ok(l) as unknown as LedgerEntry[], name: (me.data?.full_name as string) ?? '' }
  }, [])
  return (
    <>
      <PageHeader title="Payments" sub="Your invoices, payments and account ledger. Payments are recorded by EU-AFRIC once received." />
      <Async q={q}>{({ inv, pay, led, name }) => {
        const owing = inv.filter((i) => ['issued', 'partially_paid', 'overdue'].includes(i.status)).reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0)
        const paid = pay.filter((p) => p.status === 'confirmed').reduce((s, p) => s + Number(p.amount), 0)
        // Running balance on the receivables account (debits raise what you owe, credits reduce it)
        let bal = 0
        const stmt = led.filter((e) => e.ledger_accounts?.code === '1100').map((e) => ({ ...e, balance: (bal += Number(e.debit) - Number(e.credit)) }))
        const stmtCols: Col<(typeof stmt)[number]>[] = [
          { header: 'Date', get: (e) => date(e.created_at) }, { header: 'Description', get: (e) => e.description },
          { header: 'Charges', get: (e) => ghs(e.debit) }, { header: 'Payments', get: (e) => ghs(e.credit) }, { header: 'Balance', get: (e) => ghs(e.balance) },
        ]
        return (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Outstanding balance" value={ghs(owing)} icon={<Wallet size={20} />} tone={owing > 0 ? 'red' : 'green'} />
              <StatCard label="Total paid" value={ghs(paid)} icon={<Download size={20} />} />
              <StatCard label="Invoices" value={inv.length} tone="grey" icon={<FileDown size={20} />} />
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices', count: inv.length }, { id: 'payments', label: 'Payments & receipts', count: pay.length }, { id: 'statement', label: 'Account statement' }]} />
            {tab === 'invoices' && <Table rows={inv} cols={[
              { header: 'Invoice', cell: (i) => <b>{i.number}</b> }, { header: 'Issued', cell: (i) => date(i.issue_date) }, { header: 'Due', cell: (i) => date(i.due_date) },
              { header: 'Total', cell: (i) => ghs(i.total) }, { header: 'Paid', cell: (i) => ghs(i.amount_paid) }, { header: 'Balance', cell: (i) => ghs(Number(i.total) - Number(i.amount_paid)) }, { header: 'Status', cell: (i) => <Badge s={i.status} /> },
            ]} />}
            {tab === 'payments' && <Table rows={pay} cols={[
              { header: 'Receipt', cell: (p) => <b>{p.receipt_number}</b> }, { header: 'Date', cell: (p) => date(p.paid_at) }, { header: 'Invoice', cell: (p) => p.invoices?.number ?? '—' },
              { header: 'Method', cell: (p) => label(p.method) }, { header: 'Amount', cell: (p) => ghs(p.amount) }, { header: 'Status', cell: (p) => <Badge s={p.status} /> },
              { header: '', cell: (p) => p.status === 'confirmed' && <button className="btn-ghost !py-1 text-xs" onClick={() => receiptPdf({ number: p.receipt_number, client: name, invoice: p.invoices?.number ?? '', amount: ghs(p.amount), method: p.method, date: date(p.paid_at), reference: p.reference })}><Download size={13} />Receipt</button> },
            ]} />}
            {tab === 'statement' && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-gray-600">Closing balance: <b>{ghs(bal)}</b></p>
                  <div className="flex gap-2"><button className="btn-ghost" onClick={() => exportCsv('account-statement', stmtCols, stmt)}>CSV</button><button className="btn-primary" onClick={() => exportPdf('account-statement', 'Account statement', stmtCols, stmt, name)}>PDF</button></div></div>
                <Table rows={stmt} cols={[{ header: 'Date', cell: (e) => date(e.created_at) }, { header: 'Description', cell: (e) => e.description }, { header: 'Charges', cell: (e) => (Number(e.debit) ? ghs(e.debit) : '') }, { header: 'Payments', cell: (e) => (Number(e.credit) ? ghs(e.credit) : '') }, { header: 'Balance', cell: (e) => <b>{ghs(e.balance)}</b> }]} />
              </>
            )}
          </div>
        )
      }}</Async>
    </>
  )
}
