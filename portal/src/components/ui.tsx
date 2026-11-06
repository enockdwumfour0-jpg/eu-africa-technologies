import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Inbox, Loader2, Search, X } from 'lucide-react'
import { label } from '../lib/format'

/* ---------- data hook ---------- */
export function useQuery<T>(fn: () => PromiseLike<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [n, setN] = useState(0)
  const alive = useRef(0)
  useEffect(() => {
    const id = ++alive.current
    setLoading(true)
    Promise.resolve(fn()).then(
      (d) => { if (id === alive.current) { setData(d); setError(null); setLoading(false) } },
      (e) => { if (id === alive.current) { setError(e?.message ?? 'Something went wrong'); setLoading(false) } },
    )
    return () => { alive.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { data, error, loading, reload: useCallback(() => setN((x) => x + 1), []) }
}
// Throws a readable error for a supabase { data, error } result
export function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

/* ---------- toasts + confirm ---------- */
type Toast = { id: number; kind: 'ok' | 'err'; text: string }
type Confirm = { title: string; text?: string; danger?: boolean; action: string; resolve: (v: boolean) => void }
const Fb = createContext<{ toast: (t: string, kind?: 'ok' | 'err') => void; confirm: (o: Omit<Confirm, 'resolve'>) => Promise<boolean> } | null>(null)
export const useFeedback = () => { const v = useContext(Fb); if (!v) throw new Error('FeedbackProvider missing'); return v }

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dlg, setDlg] = useState<Confirm | null>(null)
  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  const confirm = useCallback((o: Omit<Confirm, 'resolve'>) => new Promise<boolean>((resolve) => setDlg({ ...o, resolve })), [])
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null) }
  return (
    <Fb.Provider value={{ toast, confirm }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[70] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm text-white shadow-lg ${t.kind === 'ok' ? 'bg-brand-green' : 'bg-red-600'}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}<span>{t.text}</span>
          </div>
        ))}
      </div>
      {dlg && (
        <Modal title={dlg.title} onClose={() => close(false)} small>
          {dlg.text && <p className="text-sm text-gray-600">{dlg.text}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => close(false)}>Cancel</button>
            <button className={dlg.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>{dlg.action}</button>
          </div>
        </Modal>
      )}
    </Fb.Provider>
  )
}
// Run an async action with toast feedback; returns true on success
export function useAction() {
  const { toast } = useFeedback()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (fn: () => PromiseLike<unknown>, success?: string) => {
    setBusy(true)
    try { await fn(); if (success) toast(success); return true }
    catch (e) { toast((e as Error)?.message || 'Something went wrong', 'err'); return false }
    finally { setBusy(false) }
  }, [toast])
  return { run, busy }
}

/* ---------- layout bits ---------- */
export function Modal({ title, onClose, children, small, wide }: { title: string; onClose: () => void; children: ReactNode; small?: boolean; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl ${small ? 'sm:max-w-md' : wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-brand-black">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
export const Spinner = ({ text = 'Loading…' }: { text?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />{text}</div>
)
export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 text-gray-400">{icon ?? <Inbox size={32} />}</div>
      <p className="font-semibold text-brand-black">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-gray-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1"><p className="font-semibold">Something went wrong</p><p className="break-words">{error}</p></div>
      {retry && <button className="btn-ghost !py-1" onClick={retry}>Retry</button>}
    </div>
  )
}
export function Async<T>({ q, children, empty }: { q: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: (d: T) => boolean | ReactNode }) {
  if (q.loading && !q.data) return <Spinner />
  if (q.error) return <ErrorBox error={q.error} retry={q.reload} />
  if (q.data == null) return null
  if (empty) { const e = empty(q.data); if (e) return <>{e === true ? <EmptyState title="Nothing here yet" /> : e}</> }
  return <>{children(q.data)}</>
}
export const PageHeader = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="font-display text-2xl font-semibold text-brand-black">{title}</h1>{sub && <p className="mt-0.5 text-sm text-gray-500">{sub}</p>}</div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
)
export const StatCard = ({ label: l, value, icon, tone = 'green', hint }: { label: string; value: ReactNode; icon?: ReactNode; tone?: 'green' | 'gold' | 'red' | 'grey'; hint?: string }) => (
  <div className="card flex items-center gap-3">
    {icon && <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${tone === 'green' ? 'bg-brand-green/10 text-brand-green' : tone === 'gold' ? 'bg-brand-yellow/25 text-yellow-800' : tone === 'red' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{icon}</div>}
    <div className="min-w-0"><p className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500">{l}</p><p className="truncate text-xl font-bold text-brand-black">{value}</p>{hint && <p className="truncate text-xs text-gray-500">{hint}</p>}</div>
  </div>
)
const TONES: Record<string, string> = {
  green: 'bg-green-100 text-green-800', gold: 'bg-yellow-100 text-yellow-800', red: 'bg-red-100 text-red-700', grey: 'bg-gray-100 text-gray-700', blue: 'bg-blue-100 text-blue-800',
}
const STATUS_TONE: Record<string, string> = {
  active: 'green', approved: 'green', completed: 'green', paid: 'green', confirmed: 'green', converted: 'green', available: 'green', current: 'blue',
  pending: 'gold', submitted: 'gold', under_review: 'blue', planning: 'blue', issued: 'blue', partially_paid: 'gold', draft: 'grey', upcoming: 'grey', on_hold: 'gold', open: 'blue', in_progress: 'blue',
  rejected: 'red', suspended: 'red', overdue: 'red', void: 'grey', cancelled: 'grey', reversed: 'red', closed: 'grey', resolved: 'green',
}
export const Badge = ({ s, text }: { s: string; text?: string }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[STATUS_TONE[s] ?? 'grey']}`}>{text ?? label(s)}</span>
)
export const Progress = ({ value }: { value: number }) => (
  <div className="flex items-center gap-2" aria-label={`Progress ${value}%`}>
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200"><div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
    <span className="w-9 text-right text-xs font-semibold text-gray-600">{value}%</span>
  </div>
)

/* ---------- forms ---------- */
export function Field({ label: l, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-gray-700">{l}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}
export const SearchBox = ({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    <input className="input !pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
  </div>
)
export const Select = ({ value, onChange, options, all }: { value: string; onChange: (v: string) => void; options: string[]; all?: string }) => (
  <select className="input !w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
    {all && <option value="all">{all}</option>}
    {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
  </select>
)
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; count?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${value === t.id ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------- table (scrolls on phones) ---------- */
export type Column<T> = { header: string; cell: (r: T) => ReactNode; className?: string }
export function Table<T extends { id: string | number }>({ cols, rows, onRow, empty }: { cols: Column<T>[]; rows: T[]; onRow?: (r: T) => void; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="No records found" text="Try changing the search or filters." />}</>
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="bg-brand-grey text-xs uppercase tracking-wide text-gray-500">
          <tr>{cols.map((c) => <th key={c.header} className={`px-3 py-2.5 font-semibold ${c.className ?? ''}`}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} onClick={onRow && (() => onRow(r))} className={onRow ? 'cursor-pointer hover:bg-brand-grey/70' : ''}>
              {cols.map((c) => <td key={c.header} className={`px-3 py-2.5 align-middle ${c.className ?? ''}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export const matches = (q: string, ...vals: (string | null | undefined)[]) => !q || vals.some((v) => (v ?? '').toLowerCase().includes(q.trim().toLowerCase()))
