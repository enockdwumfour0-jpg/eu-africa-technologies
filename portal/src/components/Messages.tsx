import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, CheckCheck, FileText, Lock, MessageSquarePlus, MessagesSquare, Paperclip, Send, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { ACCEPT, checkFile, openFile, upload } from '../lib/files'
import { clean, clock, dayKey, dayLabel, initials, listTime } from '../lib/format'
import type { Client, Message, Thread } from '../lib/types'
import { EmptyState, Field, Modal, SearchBox, Spinner, matches, ok, useAction, useFeedback, useQuery } from './ui'

type Mode = 'client' | 'staff' | 'agent'
type Person = { full_name: string; job_title?: string | null }
type ThreadRow = Thread & { agent_id?: string | null; staff_id?: string | null; agent?: Person | null; staff?: Person | null; clients?: Client & { profiles?: { full_name: string } } }
type Parties = { thread_id: string; agent_name: string | null; staff_name: string | null; staff_title: string | null; client_name: string | null; client_company: string | null }
// The four kinds of conversation: client<->team, agent<->office, agent<->chosen staff member, agent<->own client.
type Kind = 'team' | 'office' | 'agent_staff' | 'agent_client'
const kindOf = (t: ThreadRow): Kind => (t.staff_id ? 'agent_staff' : t.agent_id && t.client_id ? 'agent_client' : t.agent_id ? 'office' : 'team')
const clientName = (t: ThreadRow) => t.clients?.profiles?.full_name || t.clients?.company_name || 'Client'
type Last = { thread_id: string; body: string | null; attachment_name: string | null; sender_id: string; created_at: string; read_at: string | null }

// One tick = sent, two blue ticks = read by the other person.
const Ticks = ({ read, size = 14 }: { read: boolean; size?: number }) => read
  ? <CheckCheck size={size} className="shrink-0 text-sky-500" aria-label="Read" />
  : <Check size={size} className="shrink-0 text-gray-400" aria-label="Sent" />

const AVATAR_TONES = ['bg-brand-green', 'bg-[#0f5c34]', 'bg-[#8a6d00]', 'bg-[#2f3b35]', 'bg-[#1d7a8c]']
const toneFor = (s: string) => AVATAR_TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length]

function Avatar({ name, size = 'h-12 w-12 text-sm', team }: { name: string; size?: string; team?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${size} ${team ? 'bg-brand-black ring-2 ring-brand-yellow' : toneFor(name)}`} aria-hidden>
      {team ? 'EA' : initials(name)}
    </span>
  )
}

// Who the other side of the conversation is, from the point of view of the person looking at it.
function personName(t: ThreadRow, mode: Mode, uid: string) {
  const k = kindOf(t); const agent = t.agent?.full_name || 'Agent'
  if (k === 'agent_staff') return uid === t.agent_id ? t.staff?.full_name || 'Staff' : uid === t.staff_id ? agent : `${agent} ↔ ${t.staff?.full_name || 'Staff'}`
  if (k === 'agent_client') return mode === 'client' ? agent : uid === t.agent_id ? clientName(t) : `${agent} ↔ ${clientName(t)}`
  if (mode === 'staff') return k === 'office' ? agent : clientName(t)
  return 'EU-AFRIC Team'
}
const isTeamChat = (t: ThreadRow, mode: Mode) => mode !== 'staff' && (kindOf(t) === 'team' || kindOf(t) === 'office')
function subtitle(t: ThreadRow, mode: Mode, uid: string, name: string) {
  const k = kindOf(t)
  if (k === 'agent_staff') return uid === t.agent_id ? t.staff?.job_title || 'EU-AFRIC staff' : uid === t.staff_id ? 'Agent' : 'Agent chat with staff'
  if (k === 'agent_client') return mode === 'client' ? 'Your agent' : uid === t.agent_id ? (t.clients?.company_name && t.clients.company_name !== name ? t.clients.company_name : 'Your client') : 'Agent and client'
  if (mode === 'staff') return k === 'office' ? 'Agent' : t.clients?.company_name && t.clients.company_name !== name ? t.clients.company_name : 'Client'
  return 'Replies from the EU-AFRIC team'
}

export default function MessagesView({ mode, canStart = true, onlyClientId }: { mode: Mode; canStart?: boolean; onlyClientId?: string }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const { confirm } = useFeedback()
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const threads = useQuery(async () => {
    let query = supabase.from('message_threads').select('*, clients(id, company_name, profiles(full_name))').order('last_message_at', { ascending: false })
    if (onlyClientId) query = query.eq('client_id', onlyClientId)
    const t = ok(await query) as unknown as ThreadRow[]
    // names of the agent / staff member / client in agent chats (profiles are not readable by every role, so they come from the database function)
    const parties = new Map((ok(await supabase.rpc('chat_parties')) as unknown as Parties[]).map((p) => [p.thread_id, p]))
    t.forEach((th) => {
      const p = parties.get(th.id); if (!p) return
      th.agent = th.agent_id ? { full_name: p.agent_name || 'Agent' } : null
      th.staff = th.staff_id ? { full_name: p.staff_name || 'Staff', job_title: p.staff_title } : null
      if (th.client_id && p.client_name) th.clients = { ...(th.clients ?? { id: th.client_id }), company_name: p.client_company, profiles: { full_name: p.client_name } } as unknown as ThreadRow['clients']
    })
    const byId = new Map(t.map((x) => [x.id, x]))
    const un = ok(await supabase.from('messages').select('thread_id, sender_id, from_staff').is('read_at', null)) as { thread_id: string; sender_id: string; from_staff: boolean }[]
    const counts: Record<string, number> = {}
    un.forEach((m) => {
      const th = byId.get(m.thread_id); if (!th) return
      const k = kindOf(th)
      // agent chats are between two people: count what the other person sent (a bystander administrator has no unread count)
      const count = k === 'agent_staff' || k === 'agent_client' ? m.sender_id !== uid && (mode === 'client' || uid === th.agent_id || uid === th.staff_id) : m.from_staff === (mode !== 'staff')
      if (count) counts[m.thread_id] = (counts[m.thread_id] ?? 0) + 1
    })
    // newest message per thread, for the preview line in the list
    const recent = ok(await supabase.from('messages').select('thread_id, body, attachment_name, sender_id, created_at, read_at').order('created_at', { ascending: false }).limit(500)) as Last[]
    const last: Record<string, Last> = {}
    recent.forEach((m) => { if (!last[m.thread_id]) last[m.thread_id] = m })
    return { t, counts, last }
  }, [mode, onlyClientId])

  // live refresh of the list when any message in an accessible thread arrives
  useEffect(() => {
    const ch = supabase.channel('threads-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => threads.reload()).subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  const rows = (threads.data?.t ?? []).filter((t) => matches(q, t.clients?.profiles?.full_name, t.clients?.company_name, t.agent?.full_name, t.staff?.full_name, mode !== 'staff' && !t.staff_id && !(t.agent_id && t.client_id) ? 'EU-AFRIC Team' : ''))
  const active = threads.data?.t.find((t) => t.id === sel) ?? null

  return (
    <div className="grid h-[calc(100dvh-10.5rem)] min-h-[30rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ---------- conversation list ---------- */}
      <div className={`${sel ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-col border-r border-gray-200 bg-white`}>
        <div className="flex items-center gap-2 border-b bg-white p-3">
          <h2 className="mr-auto pl-1 font-display text-lg font-semibold text-brand-black md:hidden">Chats</h2>
          <div className="hidden flex-1 md:block"><SearchBox value={q} onChange={setQ} placeholder="Search chats" /></div>
          {canStart && <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-green text-white shadow-sm transition hover:bg-[#126b39]" aria-label="New chat" title="New chat"
            onClick={() => {
              // a client has one chat with the team: open it instead of making another (agents choose who to message)
              const mine = mode === 'client' ? threads.data?.t.find((t) => t.status === 'open' && kindOf(t) === 'team') : undefined
              if (mine) setSel(mine.id); else setCreating(true)
            }}><MessageSquarePlus size={18} /></button>}
        </div>
        <div className="border-b px-3 pb-3 pt-2 md:hidden"><SearchBox value={q} onChange={setQ} placeholder="Search chats" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.loading && !threads.data ? <Spinner /> : threads.error ? <p className="p-4 text-sm text-red-600">{threads.error}</p> :
            rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-green/10 text-brand-green"><MessagesSquare size={26} /></span>
                <p className="font-semibold text-brand-black">{q ? 'No chats match your search' : 'No conversations yet'}</p>
                {!q && canStart && <p className="mt-1 text-sm text-gray-500">Tap the green button to start one.</p>}
              </div>
            ) :
              rows.map((t) => {
                const n = threads.data?.counts[t.id] ?? 0
                const l = threads.data?.last[t.id]
                const name = personName(t, mode, uid)
                const mineLast = !!l && l.sender_id === uid
                const preview = l ? (l.body || (l.attachment_name ? '📎 ' + l.attachment_name : '')) : 'No messages yet'
                return (
                  <button key={t.id} onClick={() => setSel(t.id)} className={`flex w-full items-center gap-3 border-b border-gray-100 px-3 py-3 text-left transition hover:bg-gray-50 ${sel === t.id ? 'bg-brand-green/10' : ''}`}>
                    <Avatar name={name} team={isTeamChat(t, mode)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[15px] ${n ? 'font-bold' : 'font-semibold'} text-brand-black`}>{name}</span>
                        <span className={`shrink-0 text-[11px] ${n ? 'font-semibold text-brand-green' : 'text-gray-400'}`}>{listTime(l?.created_at ?? t.last_message_at)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`flex min-w-0 items-center gap-1 text-sm ${n ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>
                          {mineLast && <Ticks read={!!l!.read_at} />}
                          <span className="truncate">{preview}</span>
                          {t.status === 'closed' && <Lock size={11} className="shrink-0 text-gray-400" aria-label="Closed" />}
                        </span>
                        {n > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-green px-1.5 text-[11px] font-bold text-white">{n > 99 ? '99+' : n}</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
        </div>
      </div>

      {/* ---------- chat pane ---------- */}
      <div className={`${sel ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}>
        {active ? <Conversation key={active.id} thread={active} mode={mode} uid={uid} back={() => setSel(null)} onChanged={threads.reload}
          onClose={async () => { if (await confirm({ title: 'Close this conversation?', text: 'No more messages can be sent until it is reopened.', action: 'Close' })) { await supabase.from('message_threads').update({ status: 'closed' }).eq('id', active.id); threads.reload() } }} />
          : <div className="chat-wall m-0 grid flex-1 place-items-center p-6"><EmptyState title="Select a chat" text="Messages are private between you and the EU-AFRIC team." icon={<MessagesSquare size={34} />} /></div>}
      </div>
      {creating && <NewThread mode={mode} openThreads={(threads.data?.t ?? []).filter((t) => t.status === 'open')} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); threads.reload(); setSel(id) }} />}
    </div>
  )
}

function Conversation({ thread, mode, uid, back, onChanged, onClose }: { thread: ThreadRow; mode: Mode; uid: string; back: () => void; onChanged: () => void; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const { run, busy } = useAction()
  const { toast, confirm } = useFeedback()
  const kind = kindOf(thread)
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const first = useRef(true)

  const markRead = useCallback(() => {
    supabase.rpc('mark_thread_read', { p_thread: thread.id }).then(async () => {
      onChanged()
      // refresh our copy of the read state, so the ticks and the Delete option are up to date
      const { data } = await supabase.from('messages').select('id, read_at').eq('thread_id', thread.id)
      const r = new Map(((data ?? []) as { id: string; read_at: string | null }[]).map((x) => [x.id, x.read_at]))
      setMsgs((l) => l.map((x) => (r.has(x.id) ? { ...x, read_at: r.get(x.id) ?? null } : x)))
    })
  }, [thread.id])
  // Delete a message for yourself only: the other people in the chat keep it. You can delete messages you sent or have read.
  async function removeMsg(m: Message) {
    if (!(await confirm({ title: 'Delete this message?', text: 'It is removed from your chat only. The other people in the chat still see it.', action: 'Delete', danger: true }))) return
    const { error } = await supabase.from('message_hides').insert({ message_id: m.id })
    if (error) return toast('Could not delete the message', 'err')
    setMsgs((l) => l.filter((x) => x.id !== m.id)); onChanged()
  }
  useEffect(() => {
    supabase.from('messages').select('*').eq('thread_id', thread.id).order('created_at').then(({ data }) => { setMsgs((data as Message[]) ?? []); setLoading(false); markRead() })
    const ch = supabase.channel('msg-' + thread.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${thread.id}` }, (p) => {
        setMsgs((m) => (m.some((x) => x.id === (p.new as Message).id) ? m : [...m, p.new as Message])); markRead()
      })
      // when the other side opens the chat their app marks our messages read; flip the ticks to "read" live.
      // (No server-side filter here: it is checked in the handler, which is reliable for UPDATE events.)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => {
        const n = p.new as Message
        if (n.thread_id !== thread.id) return
        setMsgs((m) => m.map((x) => (x.id === n.id ? { ...x, read_at: n.read_at } : x)))
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [thread.id])
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: first.current ? 'auto' : 'smooth' })
    if (msgs.length) first.current = false
  }, [msgs.length])

  // grow the composer with its content, up to a limit (like a messaging app)
  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'
  }, [text])

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
    if (done) { setText(''); setFile(null); onChanged(); box.current?.focus() }
  }
  const name = personName(thread, mode, uid)
  const delBtn = (m: Message) => (
    <button type="button" onClick={() => removeMsg(m)} aria-label="Delete message" title="Delete message"
      className="mb-1 shrink-0 self-center rounded-full p-1.5 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"><Trash2 size={14} /></button>)
  return (
    <>
      <div className="flex items-center gap-3 border-b bg-white px-3 py-2.5">
        <button className="-ml-1 rounded-full p-2 text-gray-600 hover:bg-gray-100 md:hidden" onClick={back} aria-label="Back to chats"><ArrowLeft size={20} /></button>
        <Avatar name={name} size="h-10 w-10 text-xs" team={isTeamChat(thread, mode)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight text-brand-black">{name}</p>
          <p className="truncate text-xs text-gray-500">{subtitle(thread, mode, uid, name)}</p>
        </div>
        {thread.status === 'closed'
          ? <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600"><Lock size={12} />Closed</span>
          : mode === 'staff' && <button className="btn-ghost !rounded-full !px-2.5 !py-1.5 text-xs" onClick={onClose} aria-label="Close chat" title="Close chat"><Lock size={14} /><span className="hidden sm:inline">Close chat</span></button>}
      </div>

      <div className="chat-wall min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" aria-live="polite">
        {loading ? <Spinner /> : msgs.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">No messages yet.</p> : msgs.map((m, i) => {
          const mine = m.sender_id === uid
          const prev = msgs[i - 1]
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
          const startOfRun = newDay || prev!.sender_id !== m.sender_id
          return (
            <Fragment key={m.id}>
              {newDay && <div className="my-3 flex justify-center"><span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 shadow-sm">{dayLabel(m.created_at)}</span></div>}
              <div className={`group flex items-end gap-1 ${mine ? 'justify-end' : 'justify-start'} ${startOfRun ? 'mt-2' : 'mt-0.5'}`}>
                {mine && delBtn(m)}
                <div className={`relative max-w-[82%] rounded-2xl px-3 pb-1.5 pt-2 text-[15px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,.12)] sm:max-w-[70%] ${mine ? 'bg-[#dcf8c6] text-brand-black' : 'bg-white text-brand-black'} ${startOfRun ? (mine ? 'rounded-tr-sm' : 'rounded-tl-sm') : ''}`}>
                  {!mine && startOfRun && m.from_staff && <p className="mb-0.5 text-xs font-bold text-brand-green">{kind === 'agent_staff' ? thread.staff?.full_name || 'Staff' : 'EU-AFRIC'}</p>}
                  {m.attachment_path && (
                    <button onClick={() => openFile('message-attachments', m.attachment_path!, m.attachment_name ?? undefined).catch(() => toast('Could not open file', 'err'))}
                      className="mb-1 flex w-full items-center gap-2 rounded-lg bg-black/5 p-2 text-left hover:bg-black/10">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-green/15 text-brand-green"><FileText size={18} /></span>
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{m.attachment_name ?? 'Attachment'}</span><span className="block text-[11px] text-gray-500">Tap to open</span></span>
                    </button>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}{/* spacer keeps the time stamp from overlapping the last line */}<span className="inline-block w-[4.25rem]" aria-hidden /></p>}
                  <span className={`float-right -mt-3.5 flex items-center gap-0.5 text-[10.5px] ${m.body ? '' : '!mt-0'} text-gray-500`}>
                    {clock(m.created_at)}
                    {mine && <Ticks read={!!m.read_at} />}
                  </span>
                </div>
                {!mine && !!m.read_at && delBtn(m)}
              </div>
            </Fragment>
          )
        })}
        <div ref={end} />
      </div>

      {thread.status === 'open' ? (
        <form onSubmit={send} className="border-t bg-[#f0f2f0] px-3 py-2.5">
          {file && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
              <FileText size={16} className="text-brand-green" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" className="rounded-full p-1 text-gray-500 hover:bg-gray-100" onClick={() => setFile(null)} aria-label="Remove attachment"><X size={14} /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 items-end rounded-3xl bg-white px-1.5 shadow-sm ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-brand-green/40">
              <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-brand-green" title="Attach a file" aria-label="Attach a file">
                <Paperclip size={19} /><input type="file" accept={ACCEPT} className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
              </label>
              <textarea ref={box} className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-5 outline-none placeholder:text-gray-400" rows={1} maxLength={4000} placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
            </div>
            <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-green text-white shadow-sm transition hover:bg-[#126b39] disabled:opacity-40" disabled={busy || (!text.trim() && !file)} aria-label="Send"><Send size={18} className="translate-x-px" /></button>
          </div>
        </form>
      ) : <p className="border-t bg-[#f0f2f0] p-3 text-center text-sm text-gray-500">This conversation is closed.</p>}
    </>
  )
}

function NewThread({ mode, openThreads, onClose, onCreated }: { mode: Mode; openThreads: ThreadRow[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const [body, setBody] = useState('')
  const [clientId, setClientId] = useState('')
  const [to, setTo] = useState('office') // agents: 'office' | 'staff:<id>' | 'client:<id>'
  const { run, busy } = useAction()
  const clients = useQuery(async () => (mode === 'agent' ? [] : ok(await supabase.from('clients').select('id, company_name, profiles(full_name)').order('created_at'))) as unknown as (Client & { profiles: { full_name: string } })[], [mode])
  // agents choose from the office, the staff an administrator has chosen, and their own clients
  const contacts = useQuery(async () => (mode === 'agent' ? ok(await supabase.rpc('agent_message_contacts')) : []) as unknown as { id: string; full_name: string; job_title: string | null }[], [mode])
  const mineClients = useQuery(async () => (mode === 'agent' ? ok(await supabase.rpc('agent_client_overview')) : []) as unknown as { client_id: string; name: string; company: string | null; account_status: string }[], [mode])
  const mine = mode === 'agent' ? uid : mode === 'client' ? clients.data?.[0]?.id : clientId
  const nameOf = (c?: Client & { profiles?: { full_name: string } }) => c?.profiles?.full_name || c?.company_name || 'Client'
  const activeClients = (mineClients.data ?? []).filter((c) => c.account_status === 'active')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const msg = clean(body)
    if (!mine || !msg) return
    await run(async () => {
      let id: string | undefined
      if (mode === 'agent') {
        const [kind, ref] = to.split(':')
        // one open chat per person: if there is already one, the message goes into it
        id = openThreads.find((t) => (kind === 'office' ? kindOf(t) === 'office' : kind === 'staff' ? t.staff_id === ref : kindOf(t) === 'agent_client' && t.client_id === ref))?.id
        if (!id) {
          const me = ok(await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle()) as { full_name: string } | null
          // the database needs a title for the thread; it is the other person's name (the office chat uses the agent's own name)
          const row = kind === 'staff' ? { agent_id: uid, staff_id: ref, subject: contacts.data?.find((c) => c.id === ref)?.full_name }
            : kind === 'client' ? { agent_id: uid, client_id: ref, subject: activeClients.find((c) => c.client_id === ref)?.name }
            : { agent_id: uid, subject: me?.full_name }
          const r = await supabase.from('message_threads').insert({ ...row, subject: (row.subject || 'Chat').slice(0, 160), created_by: uid }).select('id').single()
          if (r.error) throw r.error
          id = r.data.id as string
        }
      } else {
        id = openThreads.find((t) => kindOf(t) === 'team' && t.client_id === mine)?.id
        if (!id) {
          // the database needs a title for the thread; it is simply the client's name (also used in notifications)
          const title = nameOf(clients.data?.find((c) => c.id === mine)).slice(0, 160)
          const { data, error } = await supabase.from('message_threads').insert({ client_id: mine, subject: title, created_by: uid }).select('id').single()
          if (error) throw error
          id = data.id as string
        }
      }
      const m = await supabase.from('messages').insert({ thread_id: id, sender_id: uid, body: msg })
      if (m.error) throw m.error
      onCreated(id)
    })
  }
  return (
    <Modal title="New chat" onClose={onClose} small>
      <form onSubmit={submit} className="space-y-4">
        {mode === 'staff' && (
          <Field label="Client"><select className="input" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client…</option>{(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}</select></Field>
        )}
        {mode === 'agent' && (
          <Field label="Send to" hint={(contacts.data ?? []).length === 0 ? 'The EU-AFRIC team chooses which staff members you can message.' : undefined}>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="office">EU-AFRIC office</option>
              {(contacts.data ?? []).length > 0 && <optgroup label="Staff">{contacts.data!.map((c) => <option key={c.id} value={'staff:' + c.id}>{c.full_name}{c.job_title ? ` · ${c.job_title}` : ''}</option>)}</optgroup>}
              {activeClients.length > 0 && <optgroup label="My clients">{activeClients.map((c) => <option key={c.client_id} value={'client:' + c.client_id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}</optgroup>}
            </select></Field>
        )}
        <Field label="Message"><textarea className="input" required autoFocus rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type your message…" /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !mine || !body.trim()}><Send size={15} />Send</button></div>
      </form>
    </Modal>
  )
}
