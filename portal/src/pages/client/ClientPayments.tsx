import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileDown, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, PageHeader, StatCard, Table, Tabs, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { date, ghs, label } from '../../lib/format'
import { exportCsv, exportPdf, receiptPdf, type Col } from '../../lib/export'
import type { Deposit, Invoice, LedgerEntry, Payment } from '../../lib/types'

export default function ClientPayments() {
  const [tab, setTab] = useState('invoices')
  const [params, setParams] = useSearchParams(); const { toast } = useFeedback(); const { run, busy } = useAction()
  const q = useQuery(async () => {
    const [i, p, l, me, dp] = await Promise.all([
      supabase.from('invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('payments').select('*, invoices(number)').order('paid_at', { ascending: false }),
      supabase.from('ledger_entries').select('*, ledger_accounts(code, name)').order('created_at', { ascending: true }),
      supabase.from('profiles').select('full_name').maybeSingle(),
      supabase.from('deposits').select('*').order('paid_at', { ascending: false }),
    ])
    return { inv: ok(i) as Invoice[], pay: ok(p) as unknown as Payment[], led: ok(l) as unknown as LedgerEntry[], dep: ok(dp) as Deposit[], name: (me.data?.full_name as string) ?? '' }
  }, [])
  const [online, setOnline] = useState(false)
  useEffect(() => { void supabase.rpc('online_payments_enabled').then((r) => setOnline(r.data === true)) }, [])
  // Back from Paystack: confirm the payment with the server, then refresh
  const ref = params.get('ref'); const [checking, setChecking] = useState(false); const [unsure, setUnsure] = useState(false)
  const confirmPayment = async (reference: string) => {
    setChecking(true)
    const { data, error } = await supabase.functions.invoke('paystack-payments', { body: { action: 'verify', reference } })
    setChecking(false)
    const st = (data as { status?: string } | null)?.status
    if (error || st === 'network' || st === 'error' || st === 'unknown') { setUnsure(true); return } // keep the reference so it can be re-checked
    setUnsure(false); setParams({}, { replace: true }); q.reload()
    if (st === 'success') toast('Payment received. Thank you!')
    else if (st === 'flagged') toast('Your payment was received and is being reviewed by our team.')
    else toast('The payment was not completed. You have not been charged for it, or it is still processing.', 'err')
  }
  useEffect(() => { if (ref) void confirmPayment(ref) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ref])
  const payOnline = (id: string) => run(async () => {
    const { data, error } = await supabase.functions.invoke('paystack-payments', { body: { action: 'initialize', invoice_id: id } })
    const url = (data as { authorization_url?: string } | null)?.authorization_url
    if (error || !url) throw new Error((data as { error?: string } | null)?.error || 'Could not start the payment. Check your connection and try again.')
    if (!url.startsWith('https://checkout.paystack.com/')) throw new Error('Could not start the payment')
    window.location.assign(url)
  })
  return (
    <>
      <PageHeader title="Payments" sub="Your invoices, payments and account ledger. Payments are recorded by EU-AFRIC once received." />
      {ref && (checking || unsure) && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        {checking ? 'Confirming your payment with Paystack…' : <>We could not confirm your payment right now, possibly because of your connection. If you were charged, it will appear here automatically once Paystack confirms it. <button className="ml-1 underline" onClick={() => void confirmPayment(ref)}>Check again</button></>}</div>}
      <Async q={q}>{({ inv, pay, led, dep, name }) => {
        const owing = inv.filter((i) => ['issued', 'partially_paid', 'overdue'].includes(i.status)).reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0)
        const paid = pay.filter((p) => p.status === 'confirmed' && p.method !== 'account_credit').reduce((s, p) => s + Number(p.amount), 0)
        // Running balance on the receivables account (debits raise what you owe, credits reduce it)
        let bal = 0
        const stmt = led.filter((e) => e.account_code === '1100').map((e) => ({ ...e, balance: (bal += Number(e.debit) - Number(e.credit)) }))
        let cb = 0
        const cred = led.filter((e) => e.account_code === '2100').map((e) => ({ ...e, balance: (cb += Number(e.credit) - Number(e.debit)) }))
        const stmtCols: Col<(typeof stmt)[number]>[] = [
          { header: 'Date', get: (e) => date(e.created_at) }, { header: 'Description', get: (e) => e.description },
          { header: 'Charges', get: (e) => ghs(e.debit) }, { header: 'Payments', get: (e) => ghs(e.credit) }, { header: 'Balance', get: (e) => ghs(e.balance) },
        ]
        return (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Outstanding balance" value={ghs(owing)} icon={<Wallet size={20} />} tone={owing > 0 ? 'red' : 'green'} />
              <StatCard label="Total paid" value={ghs(paid)} icon={<Download size={20} />} />
              <StatCard label="Account credit" value={ghs(Math.round(cb * 100) / 100)} icon={<Wallet size={20} />} tone="grey" />
              <StatCard label="Invoices" value={inv.length} tone="grey" icon={<FileDown size={20} />} />
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices', count: inv.length }, { id: 'payments', label: 'Payments & receipts', count: pay.length }, { id: 'credit', label: 'Account credit', count: dep.length }, { id: 'statement', label: 'Account statement' }]} />
            {tab === 'invoices' && <Table rows={inv} cols={[
              { header: 'Invoice', cell: (i) => <b>{i.number}</b> }, { header: 'Issued', cell: (i) => date(i.issue_date) }, { header: 'Due', cell: (i) => date(i.due_date) },
              { header: 'Total', cell: (i) => ghs(i.total) }, { header: 'Paid', cell: (i) => ghs(i.amount_paid) }, { header: 'Balance', cell: (i) => ghs(Number(i.total) - Number(i.amount_paid)) }, { header: 'Status', cell: (i) => <Badge s={i.status} /> },
              { header: '', cell: (i) => online && ['issued', 'partially_paid', 'overdue'].includes(i.status) && <button className="btn-primary !py-1 text-xs" disabled={busy} onClick={() => payOnline(i.id)}>Pay online</button> },
            ]} />}
            {tab === 'payments' && <Table rows={pay} cols={[
              { header: 'Receipt', cell: (p) => <b>{p.receipt_number}</b> }, { header: 'Date', cell: (p) => date(p.paid_at) }, { header: 'Invoice', cell: (p) => p.invoices?.number ?? '—' },
              { header: 'Method', cell: (p) => label(p.method) }, { header: 'Amount', cell: (p) => ghs(p.amount) }, { header: 'Status', cell: (p) => <Badge s={p.status} /> },
              { header: '', cell: (p) => p.status === 'confirmed' && <button className="btn-ghost !py-1 text-xs" onClick={() => receiptPdf({ number: p.receipt_number, client: name, invoice: p.invoices?.number ?? '', amount: ghs(p.amount), method: p.method, date: date(p.paid_at), reference: p.reference })}><Download size={13} />Receipt</button> },
            ]} />}
            {tab === 'credit' && <>
              <p className="mb-3 max-w-2xl text-sm text-gray-600">Advance payments you have made are held here as credit. EU-AFRIC applies it to your invoices. It cannot be withdrawn or transferred.</p>
              <Table rows={dep} cols={[{ header: 'Receipt', cell: (x) => <b>{x.receipt_number}</b> }, { header: 'Date', cell: (x) => date(x.paid_at) }, { header: 'Method', cell: (x) => label(x.method) }, { header: 'Amount', cell: (x) => ghs(x.amount) }, { header: 'Status', cell: (x) => <Badge s={x.status} /> },
                { header: '', cell: (x) => x.status === 'confirmed' && <button className="btn-ghost !py-1 text-xs" onClick={() => receiptPdf({ number: x.receipt_number, client: name, invoice: 'Account credit deposit', amount: ghs(x.amount), method: x.method, date: date(x.paid_at), reference: x.reference })}><Download size={13} />Receipt</button> }]} />
              <h3 className="mb-2 mt-5 text-sm font-semibold text-gray-700">Credit movements</h3>
              <Table rows={cred} cols={[{ header: 'Date', cell: (e) => date(e.created_at) }, { header: 'Description', cell: (e) => e.description }, { header: 'Added', cell: (e) => (Number(e.credit) ? ghs(e.credit) : '') }, { header: 'Used', cell: (e) => (Number(e.debit) ? ghs(e.debit) : '') }, { header: 'Balance', cell: (e) => <b>{ghs(e.balance)}</b> }]} />
            </>}
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
