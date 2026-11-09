import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export type Col<T> = { header: string; get: (r: T) => string | number }

function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
// Neutralise spreadsheet formula injection (=, +, -, @) in exported text.
const cell = (v: string | number) => {
  const s = String(v ?? '')
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? "'" + s : s
  return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}
export function exportCsv<T>(name: string, cols: Col<T>[], rows: T[]) {
  const body = [cols.map((c) => cell(c.header)).join(','), ...rows.map((r) => cols.map((c) => cell(c.get(r))).join(','))].join('\r\n')
  save(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }), name + '.csv')
}
export function exportPdf<T>(name: string, title: string, cols: Col<T>[], rows: T[], subtitle?: string) {
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(16); doc.setTextColor(21, 21, 21); doc.text('EU-AFRIC Technologies Ltd', 40, 42)
  doc.setFontSize(12); doc.text(title, 40, 62)
  doc.setFontSize(9); doc.setTextColor(110); doc.text(`${subtitle ? subtitle + ' · ' : ''}Generated ${new Date().toLocaleString('en-GB')}`, 40, 78)
  autoTable(doc, {
    startY: 90, head: [cols.map((c) => c.header)], body: rows.map((r) => cols.map((c) => String(c.get(r) ?? ''))),
    styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [22, 132, 71] }, alternateRowStyles: { fillColor: [245, 247, 245] },
  })
  doc.save(name + '.pdf')
}
// Single-document PDF (receipts / statements header block)
export function receiptPdf(r: { number: string; client: string; invoice: string; amount: string; method: string; date: string; reference?: string | null }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a5' })
  doc.setFillColor(22, 132, 71); doc.rect(0, 0, 420, 70, 'F')
  doc.setTextColor(255); doc.setFontSize(16); doc.text('EU-AFRIC Technologies Ltd', 30, 32)
  doc.setFontSize(10); doc.text('Payment receipt', 30, 52)
  doc.setTextColor(21, 21, 21); doc.setFontSize(11)
  const rows: [string, string][] = [['Receipt no.', r.number], ['Received from', r.client], ['Invoice', r.invoice], ['Amount', r.amount], ['Method', r.method.replace(/_/g, ' ')], ['Date', r.date], ['Reference', r.reference || '—']]
  rows.forEach(([k, v], i) => { doc.setTextColor(110); doc.text(k, 30, 110 + i * 28); doc.setTextColor(21, 21, 21); doc.text(v, 150, 110 + i * 28) })
  doc.setFontSize(9); doc.setTextColor(110); doc.text('This receipt was generated electronically and is valid without a signature.', 30, 330)
  doc.save(r.number + '.pdf')
}
