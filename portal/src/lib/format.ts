const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', minimumFractionDigits: 2 })
export const ghs = (n: number | string | null | undefined) => money.format(Number(n ?? 0))
export const date = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const dateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const ago = (d: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  if (s < 604800) return Math.round(s / 86400) + 'd ago'
  return date(d)
}
// Chat helpers: clock time, day key/label for dividers, and a compact time for conversation lists.
export const clock = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const dayKey = (d: string) => new Date(d).toDateString()
export const dayLabel = (d: string) => {
  const x = new Date(d), t = new Date()
  const y = new Date(); y.setDate(t.getDate() - 1)
  if (x.toDateString() === t.toDateString()) return 'Today'
  if (x.toDateString() === y.toDateString()) return 'Yesterday'
  const days = (t.getTime() - x.getTime()) / 86400000
  return days < 7 ? x.toLocaleDateString('en-GB', { weekday: 'long' }) : date(d)
}
export const listTime = (d: string) => {
  const l = dayLabel(d)
  if (l === 'Today') return clock(d)
  if (l === 'Yesterday') return l
  return new Date(d).toLocaleDateString('en-GB', (Date.now() - new Date(d).getTime()) / 86400000 < 7 ? { weekday: 'short' } : { day: '2-digit', month: '2-digit', year: '2-digit' })
}
export const initials =(n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
export const bytes = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
// Strip control chars and trim. HTML is never injected (React escapes), this keeps stored text clean.
export const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
export const num = (v: string | number) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
