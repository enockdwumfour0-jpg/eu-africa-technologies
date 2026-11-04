import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Lock, MessageSquarePlus, Paperclip, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { ACCEPT, checkFile, openFile, upload } from '../lib/files'
import { ago, clean, dateTime } from '../lib/format'
import type { Client, Message, Thread } from '../lib/types'
import { Badge, EmptyState, Field, Modal, SearchBox, Spinner, matches, ok, useAction, useFeedback, useQuery } from './ui'

type Mode = 'client' | 'staff'
type ThreadRow = Thread & { clients?: Client & { profiles?: { full_name: string } }; projects?: { title: string } | null }

export default function MessagesView({ mode, canStart = true, onlyClientId }: { mode: Mode; canStart?: boolean; onlyClientId?: string }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const { confirm } = useFeedback()
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const threads = useQuery(async () => {
    let query = supabase.from('message_threads').select('*, clients(id, company_name, profiles(full_name)), projects(title)').order('last_message_at', { ascending: false })
    if (onlyClientId) query = query.eq('client_id', onlyClientId)
    const t = ok(await query) as unknown as ThreadRow[]
    const un = ok(await supabase.from('messages').select('thread_id').is('read_at', null).eq('from_staff', mode === 'client')) as { thread_id: string }[]
    const counts: Record<string, number> = {}
    un.forEach((m) => { counts[m.thread_id] = (counts[m.thread_id] ?? 0) + 1 })
    return { t, counts }
  }, [mode, onlyClientId])

  // live refresh of the list when any message in an accessible thread arrives
  useEffect(() => {
    const ch = supabase.channel('threads-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => threads.reload()).subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const rows = (threads.data?.t ?? []).filter((t) => matches(q, t.subject, t.clients?.profiles?.full_name, t.clients?.company_name, t.projects?.title))
  const active = threads.data?.t.find((t) => t.id === sel) ?? null

  return (
    <div className="grid min-h-[70vh] overflow-hidden rounded-xl border border-gray-200 bg-white md:grid-cols-[20rem_1fr]">
      <div className={`${sel ? 'hidden md:flex' : 'flex'} flex-col border-r border-gray-200`}>
        <div className="flex items-center gap-2 border-b p-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search conversations" />
          {canStart && <button className="btn-primary !px-3" onClick={() => setCreating(true)} aria-label="New conversation"><MessageSquarePlus size={16} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.loading && !threads.data ? <Spinner /> : threads.error ? <p className="p-4 text-sm text-red-600">{threads.error}</p> :
            rows.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">No conversations yet.</p> :
              rows.map((t) => {
                const n = threads.data?.counts[t.id] ?? 0
                return (
                  <button key={t.id} onClick={() => setSel(t.id)} className={`block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${sel === t.id ? 'bg-brand-green/5' : ''}`}>
                    <div className="flex items-center justify-between gap-2"><p className={`truncate text-sm ${n ? 'font-bold' : 'font-semibold'}`}>{t.subject}</p>{n > 0 && <span className="rounded-full bg-brand-green px-1.5 text-[11px] font-bold text-white">{n}</span>}</div>
                    <p className="truncate text-xs text-gray-500">{mode === 'staff' ? (t.clients?.profiles?.full_name || t.clients?.company_name || 'Client') : t.projects?.title || 'General enquiry'}{t.status === 'closed' ? ' · closed' : ''}</p>
                    <p className="text-[11px] text-gray-400">{ago(t.last_message_at)}</p>
                  </button>
                )
              })}
        </div>
      </div>
      <div className={`${sel ? 'flex' : 'hidden md:flex'} min-h-[60vh] flex-col`}>
        {active ? <Conversation key={active.id} thread={active} mode={mode} uid={uid} back={() => setSel(null)} onChanged={threads.reload}
          onClose={async () => { if (await confirm({ title: 'Close this conversation?', text: 'No more messages can be sent until it is reopened.', action: 'Close' })) { await supabase.from('message_threads').update({ status: 'closed' }).eq('id', active.id); threads.reload() } }} />
          : <div className="m-auto p-6"><EmptyState title="Select a conversation" text="Messages are private between you and the EU-AFRIC team." /></div>}
      </div>
      {creating && <NewThread mode={mode} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); threads.reload(); setSel(id) }} />}
    </div>
  )
}

function Conversation({ thread, mode, uid, back, onChanged, onClose }: { thread: ThreadRow; mode: Mode; uid: string; back: () => void; onChanged: () => void; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const { run, busy } = useAction()
  const { toast } = useFeedback()
  const end = useRef<HTMLDivElement>(null)

  const markRead = useCallback(() => { supabase.rpc('mark_thread_read', { p_thread: thread.id }).then(() => onChanged()) }, [thread.id])
  useEffect(() => {
    supabase.from('messages').select('*').eq('thread_id', thread.id).order('created_at').then(({ data }) => { setMsgs((data as Message[]) ?? []); setLoading(false); markRead() })
    const ch = supabase.channel('msg-' + thread.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${thread.id}` }, (p) => {
        setMsgs((m) => (m.some((x) => x.id === (p.new as Message).id) ? m : [...m, p.new as Message])); markRead()
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [thread.id])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = clean(text)
    if (!body && !file) return
    if (file) { const bad = checkFile(file, { maxMB: 10 }); if (bad) return toast(bad, 'err') }
    const done = await run(async () => {
      const path = file ? await upload('message-attachments', thread.id, file) : null
      const { data, error } = await supabase.from('messages').insert({ thread_id: thread.id, sender_id: uid, body: body || null, attachment_path: path, attachment_name: file?.name.slice(0, 200) ?? null }).select().single()
      if (error) throw error
      setMsgs((m) => (m.some((x) => x.id === data.id) ? m : [...m, data as Message]))
    })
    if (done) { setText(''); setFile(null); onChanged() }
  }
  const title = mode === 'staff' ? (thread.clients?.profiles?.full_name || thread.clients?.company_name || 'Client') : 'EU-AFRIC Team'
  return (
    <>
      <div className="flex items-center gap-2 border-b p-3">
        <button className="rounded p-1.5 hover:bg-gray-100 md:hidden" onClick={back} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{thread.subject}</p><p className="truncate text-xs text-gray-500">{title}{thread.projects?.title ? ` · ${thread.projects.title}` : ''}</p></div>
        {thread.status === 'closed' ? <Badge s="closed" /> : mode === 'staff' && <button className="btn-ghost !py-1 text-xs" onClick={onClose}><Lock size={13} />Close</button>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-brand-grey/60 p-4" aria-live="polite">
        {loading ? <Spinner /> : msgs.map((m) => {
          const mine = m.sender_id === uid
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${mine ? 'rounded-br-sm bg-brand-green text-white' : 'rounded-bl-sm bg-white text-brand-black'}`}>
                {!mine && <p className="mb-0.5 text-[11px] font-semibold opacity-60">{m.from_staff ? 'EU-AFRIC' : 'Client'}</p>}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachment_path && <button onClick={() => openFile('message-attachments', m.attachment_path!, m.attachment_name ?? undefined).catch(() => toast('Could not open file', 'err'))} className={`mt-1 flex items-center gap-1 text-xs underline ${mine ? 'text-white' : 'text-brand-green'}`}><Paperclip size={12} />{m.attachment_name ?? 'Attachment'}</button>}
                <p className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-gray-400'}`}>{dateTime(m.created_at)}{mine && m.read_at ? ' · read' : ''}</p>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {thread.status === 'open' ? (
        <form onSubmit={send} className="border-t p-3">
          {file && <p className="mb-2 flex items-center gap-2 text-xs text-gray-600"><Paperclip size={12} />{file.name}<button type="button" className="font-semibold text-red-600" onClick={() => setFile(null)}>remove</button></p>}
          <div className="flex items-end gap-2">
            <label className="cursor-pointer rounded-lg border border-gray-300 p-2.5 text-gray-600 hover:bg-gray-50" title="Attach a file"><Paperclip size={16} /><input type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <textarea className="input max-h-32 min-h-[2.5rem] flex-1 resize-none" rows={1} maxLength={4000} placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
            <button className="btn-primary !px-3" disabled={busy || (!text.trim() && !file)} aria-label="Send"><Send size={16} /></button>
          </div>
        </form>
      ) : <p className="border-t p-3 text-center text-sm text-gray-500">This conversation is closed.</p>}
    </>
  )
}

function NewThread({ mode, onClose, onCreated }: { mode: Mode; onClose: () => void; onCreated: (id: string) => void }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const { run, busy } = useAction()
  const clients = useQuery(async () => ok(await supabase.from('clients').select('id, company_name, profiles(full_name)').order('created_at')) as unknown as (Client & { profiles: { full_name: string } })[], [])
  const projects = useQuery(async () => ok(await supabase.from('projects').select('id, title, client_id').eq('archived', false).order('title')) as unknown as { id: string; title: string; client_id: string }[], [])
  const mine = mode === 'client' ? clients.data?.[0]?.id : clientId
  const projs = (projects.data ?? []).filter((p) => !mine || p.client_id === mine)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!mine) return
    const ok_ = await run(async () => {
      const { data, error } = await supabase.from('message_threads').insert({ client_id: mine, project_id: projectId || null, subject: clean(subject).slice(0, 160), created_by: uid }).select('id').single()
      if (error) throw error
      const m = await supabase.from('messages').insert({ thread_id: data.id, sender_id: uid, body: clean(body) })
      if (m.error) throw m.error
      onCreated(data.id)
    })
    void ok_
  }
  return (
    <Modal title="New conversation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {mode === 'staff' && (
          <Field label="Client"><select className="input" required value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId('') }}>
            <option value="">Select a client…</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.profiles?.full_name || c.company_name}</option>)}</select></Field>
        )}
        <Field label="Related project (optional)"><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">General enquiry</option>{projs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
        <Field label="Subject"><input className="input" required maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="input" required rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !mine}>Send</button></div>
      </form>
    </Modal>
  )
}
