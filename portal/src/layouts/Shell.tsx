import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Menu, Trash2, User, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { ago, initials } from '../lib/format'
import { ROLE_LABEL } from '../lib/roles'
import type { Notification } from '../lib/types'
import { signedUrl } from '../lib/files'

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }

function NotificationCentre({ base }: { base: string }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const box = useRef<HTMLDivElement>(null)

  const load = () => supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(25)
    .then(({ data }) => setItems((data as Notification[]) ?? []))
  useEffect(() => {
    load()
    const ch = supabase.channel('notif-' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid])
  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const unread = items.filter((n) => !n.read_at).length
  const markAll = async () => { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); load() }
  const readCount = items.filter((n) => n.read_at).length
  // Only notifications you have already read can be deleted (the database enforces this too).
  const removeOne = async (n: Notification) => { setItems((l) => l.filter((x) => x.id !== n.id)); await supabase.from('notifications').delete().eq('id', n.id).not('read_at', 'is', null); load() }
  const clearRead = async () => { await supabase.from('notifications').delete().not('read_at', 'is', null); load() }
  const openOne = async (n: Notification) => {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    setOpen(false); load()
    if (n.link) nav(n.link.startsWith('/') ? n.link : base)
  }
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} className="relative rounded-full p-2 text-gray-600 hover:bg-gray-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={20} />
        {unread > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            <div className="flex items-center gap-3">
              {unread > 0 && <button onClick={markAll} className="text-xs font-semibold text-brand-green hover:underline">Mark all read</button>}
              {readCount > 0 && <button onClick={clearRead} className="text-xs font-semibold text-gray-500 hover:text-red-600 hover:underline">Clear read</button>}
            </div>
          </div>
          <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} className="group relative">
                <button onClick={() => openOne(n)} className={`flex w-full gap-2 px-4 py-3 text-left hover:bg-gray-50 ${n.read_at ? 'pr-11' : 'bg-brand-green/5'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-brand-green'}`} />
                  <span className="min-w-0"><span className="block text-sm font-semibold text-brand-black">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-gray-600">{n.body}</span>}
                    <span className="text-[11px] text-gray-400">{ago(n.created_at)}</span></span>
                </button>
                {n.read_at && <button onClick={() => removeOne(n)} className="absolute right-2 top-2.5 rounded-full p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300" aria-label={`Delete notification: ${n.title}`} title="Delete"><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function Shell({ nav, title, base, profilePath, children }: { nav: NavItem[]; title: string; base: string; profilePath?: string; children?: ReactNode }) {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false)
  const [me, setMe] = useState<{ full_name: string; avatar_path: string | null; job_title: string | null } | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const menuBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.from('profiles').select('full_name, avatar_path, job_title').eq('id', session!.user.id).maybeSingle().then(({ data }) => {
      setMe(data); if (data?.avatar_path) signedUrl('avatars', data.avatar_path).then(setAvatar).catch(() => {})
    })
  }, [session])
  useEffect(() => {
    const h = (e: MouseEvent) => menuBox.current && !menuBox.current.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const name = me?.full_name || session!.user.email || ''

  const links = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Dashboard">
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setDrawer(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-brand-green text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'}`}>
          <n.icon size={18} />{n.label}
        </NavLink>
      ))}
    </nav>
  )
  const brand = (
    <a href="/" className="flex items-center gap-3 px-5 py-4" aria-label="EU-AFRIC Technologies — public website">
      <img src="/img/logo.png" alt="" className="h-9 w-9 rounded bg-white object-contain p-0.5" />
      <span className="leading-tight"><span className="block text-sm font-bold text-white">EU-AFRIC</span><span className="block text-[11px] text-brand-yellow">{title}</span></span>
    </a>
  )
  return (
    <div className="min-h-screen bg-brand-grey">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-black lg:flex">{brand}{links}
        <a href="/" className="m-3 rounded-lg border border-white/15 px-3 py-2 text-center text-xs text-gray-300 hover:bg-white/10">← Back to website</a></aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-black">
            <button className="absolute right-2 top-3 rounded p-2 text-white" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={20} /></button>
            {brand}{links}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 sm:px-6">
          <button className="rounded p-2 text-gray-700 hover:bg-gray-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={22} /></button>
          <div className="hidden text-sm font-semibold text-gray-500 lg:block">{title}</div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationCentre base={base} />
            <div className="relative" ref={menuBox}>
              <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-gray-100" aria-expanded={menu} aria-label="Account menu">
                {avatar ? <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" /> :
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-green text-xs font-bold text-white">{initials(name)}</span>}
                <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:block">{name}</span><ChevronDown size={14} className="text-gray-500" />
              </button>
              {menu && (
                <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
                  <div className="border-b px-4 py-2"><p className="truncate text-sm font-semibold">{name}</p><p className="truncate text-xs text-gray-500">{session!.user.email}</p>
                    {me?.job_title && <p className="truncate text-xs font-semibold text-gray-700">{me.job_title}</p>}
                    <p className="mt-1 inline-block rounded bg-brand-yellow/30 px-1.5 text-[11px] font-semibold text-yellow-900">{role ? ROLE_LABEL[role] : ''}</p></div>
                  {profilePath && <Link to={profilePath} onClick={() => setMenu(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"><User size={15} />My profile</Link>}
                  <button onClick={async () => { await signOut(); navigate('/login') }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-700 hover:bg-red-50"><LogOut size={15} />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-3 sm:p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}
