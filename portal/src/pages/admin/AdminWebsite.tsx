import { useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Async, Badge, EmptyState, Field, Modal, PageHeader, Table, Tabs, ok, useAction, useFeedback, useQuery } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { clean, dateTime, ghs, initials, num } from '../../lib/format'

// Website content: enquiries, land listings and gallery that power the public site (eatl.co.com).
export default function AdminWebsite() {
  const { role } = useAuth(); const full = role === 'super_admin'
  const [tab, setTab] = useState(full ? 'text' : 'enquiries')
  if (!full) return (<><PageHeader title="Enquiries" sub="Messages sent through the website contact forms. Editing the website itself is for the Super Administrator." /><Enquiries /></>)
  return (<><PageHeader title="Website content" sub="Edit the text on eatl.co.com and manage the team, enquiries, land listings and gallery shown there." />
    <Tabs value={tab} onChange={setTab} tabs={[{ id: 'text', label: 'Page text' }, { id: 'team', label: 'Team' }, { id: 'enquiries', label: 'Enquiries' }, { id: 'lands', label: 'Land listings' }, { id: 'gallery', label: 'Gallery' }]} />
    {tab === 'text' ? <PageText /> : tab === 'team' ? <Team /> : tab === 'enquiries' ? <Enquiries /> : tab === 'lands' ? <Lands /> : <Gallery />}</>)
}

// ---------------------------------------------------------------- team
// The "Our team" page is built from this list, so adding, hiding or deleting a person here changes the public site.
type Member = { id: string; name: string; title: string; section: 'leadership' | 'team' | 'group'; photo_url: string | null; sort_order: number; published: boolean }
const SECTIONS: { id: Member['section']; label: string; hint: string }[] = [
  { id: 'leadership', label: 'Leadership', hint: 'Large photo cards at the top of the page.' },
  { id: 'team', label: 'Our wider team', hint: 'Round photo cards under "The people behind our work".' },
  { id: 'group', label: 'Group companies and partners', hint: 'Round photo cards under "Colleagues across our group".' },
]
const photoSrc = (u: string | null) => (u ? (/^https?:/.test(u) ? u : '/' + u) : '')
const teamPhotoPath = (u: string | null) => u?.match(/\/gallery\/(team\/[^?]+)$/)?.[1]

function Team() {
  const q = useQuery(async () => ok(await supabase.from('team_members').select('*').order('section').order('sort_order')) as Member[], [])
  const { run } = useAction(); const { confirm } = useFeedback(); const [form, setForm] = useState<Member | 'new' | null>(null)
  const move = (m: Member, list: Member[], dir: -1 | 1) => {
    const i = list.findIndex((x) => x.id === m.id), o = list[i + dir]; if (!o) return
    run(async () => { // swap the two sort positions
      ok(await supabase.from('team_members').update({ sort_order: o.sort_order }).eq('id', m.id))
      ok(await supabase.from('team_members').update({ sort_order: m.sort_order }).eq('id', o.id))
    }).then(q.reload)
  }
  const remove = async (m: Member) => {
    if (!(await confirm({ title: `Delete ${m.name}?`, text: 'They are removed from the website straight away. This cannot be undone. To keep them but stop showing them, use Hide instead.', action: 'Delete', danger: true }))) return
    await run(async () => { ok(await supabase.from('team_members').delete().eq('id', m.id)); const p = teamPhotoPath(m.photo_url); if (p) await supabase.storage.from('gallery').remove([p]) }, `${m.name} deleted`)
    q.reload()
  }
  return (<>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <p className="max-w-2xl text-sm text-gray-600">These people appear on the public Our team page. Add a person, change a photo or position, reorder with the arrows, hide someone temporarily, or delete them.</p>
      <button className="btn-primary" onClick={() => setForm('new')}><Plus size={15} />Add team member</button></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No team members" text="Add the first person to show on the Our team page." />}>{(rows) => (
      <div className="space-y-6">{SECTIONS.map((s) => { const list = rows.filter((r) => r.section === s.id); return (
        <section key={s.id}><div className="mb-2"><h2 className="font-display text-lg font-semibold">{s.label} <span className="text-sm font-normal text-gray-500">({list.length})</span></h2><p className="text-xs text-gray-500">{s.hint}</p></div>
          {list.length === 0 ? <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-gray-500">No one here yet.</p> :
            <ul className="divide-y overflow-hidden rounded-xl border bg-white">{list.map((m, i) => (
              <li key={m.id} className={`flex items-center gap-3 p-3 ${m.published ? '' : 'bg-gray-50 opacity-70'}`}>
                {m.photo_url ? <img src={photoSrc(m.photo_url)} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" loading="lazy" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-green/10 text-sm font-bold text-brand-green">{initials(m.name)}</span>}
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{m.name}{!m.published && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">Hidden</span>}</p><p className="truncate text-xs text-gray-500">{m.title || 'No position'}</p></div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button className="p-1.5 text-gray-500 hover:text-brand-green disabled:opacity-30" aria-label="Move up" disabled={i === 0} onClick={() => move(m, list, -1)}><ChevronUp size={16} /></button>
                  <button className="p-1.5 text-gray-500 hover:text-brand-green disabled:opacity-30" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(m, list, 1)}><ChevronDown size={16} /></button>
                  <button className="p-1.5 text-gray-500 hover:text-brand-green" aria-label={m.published ? 'Hide from website' : 'Show on website'} title={m.published ? 'Hide from website' : 'Show on website'} onClick={() => run(async () => { ok(await supabase.from('team_members').update({ published: !m.published }).eq('id', m.id)) }).then(q.reload)}>{m.published ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                  <button className="p-1.5 text-gray-500 hover:text-brand-green" aria-label="Edit" onClick={() => setForm(m)}><Pencil size={16} /></button>
                  <button className="p-1.5 text-gray-500 hover:text-red-600" aria-label={`Delete ${m.name}`} onClick={() => remove(m)}><Trash2 size={16} /></button>
                </div></li>))}</ul>}
        </section>) })}</div>)}</Async>
    {form && <TeamForm member={form === 'new' ? null : form} rows={q.data ?? []} onClose={() => setForm(null)} onDone={() => { setForm(null); q.reload() }} />}
  </>)
}

function TeamForm({ member, rows, onClose, onDone }: { member: Member | null; rows: Member[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: member?.name ?? '', title: member?.title ?? '', section: (member?.section ?? 'team') as Member['section'] })
  const [file, setFile] = useState<File | null>(null); const { run, busy } = useAction(); const { toast } = useFeedback()
  const submit = async (e: FormEvent) => { e.preventDefault()
    if (file && !/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Choose a JPG, PNG or WebP photo.', 'err')
    if (file && file.size > 15 * 1024 * 1024) return toast('That photo is too large (15 MB maximum).', 'err')
    const d = await run(async () => {
      let photo_url = member?.photo_url ?? null, uploaded: string | null = null
      if (file) {
        const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'member'; uploaded = `team/${Date.now()}-${slug}.jpg`
        const up = await supabase.storage.from('gallery').upload(uploaded, await resizeJpeg(file), { contentType: 'image/jpeg', upsert: false }); if (up.error) throw up.error
        photo_url = supabase.storage.from('gallery').getPublicUrl(uploaded).data.publicUrl
      }
      const body = { name: clean(f.name), title: clean(f.title), section: f.section, photo_url }
      // a new person goes to the end of their section; moving a person to another section also puts them last there
      const last = Math.max(0, ...rows.filter((r) => r.section === f.section && r.id !== member?.id).map((r) => r.sort_order))
      const r = member ? await supabase.from('team_members').update(member.section === f.section ? body : { ...body, sort_order: last + 10 }).eq('id', member.id) : await supabase.from('team_members').insert({ ...body, sort_order: last + 10 })
      if (r.error) { if (uploaded) await supabase.storage.from('gallery').remove([uploaded]); throw r.error }
      const old = uploaded ? teamPhotoPath(member?.photo_url ?? null) : null; if (old) await supabase.storage.from('gallery').remove([old]) // replaced photo no longer needed
    }, member ? 'Team member saved' : 'Team member added'); if (d) onDone()
  }
  return <Modal title={member ? `Edit ${member.name}` : 'Add team member'} onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Full name"><input className="input" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Position"><input className="input" maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Site Supervisor" /></Field>
    <Field label="Where on the page"><select className="input" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value as Member['section'] })}>{SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
    <Field label={member?.photo_url ? 'Replace photo (optional)' : 'Photo (optional)'} hint="A clear head-and-shoulders photo works best. JPG, PNG or WebP, resized automatically.">
      <div className="flex items-center gap-3">{member?.photo_url && !file && <img src={photoSrc(member.photo_url)} alt="" className="h-14 w-14 rounded-full object-cover" />}
        <input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !f.name.trim()}>{busy ? 'Saving…' : 'Save'}</button></div></form></Modal>
}

type Enq = { id: string; created_at: string; name: string; phone: string; country: string; topic: string; preferred_time: string | null; email: string | null; message: string | null; status: string; notes: string | null }
function Enquiries() {
  const q = useQuery(async () => ok(await supabase.from('enquiries').select('*').order('created_at', { ascending: false }).limit(500)) as Enq[], [])
  const { run } = useAction(); const { confirm } = useFeedback(); const [open, setOpen] = useState<Enq | null>(null)
  const setStatus = (e: Enq, status: string) => run(async () => { ok(await supabase.from('enquiries').update({ status }).eq('id', e.id)) }, 'Status saved').then(q.reload)
  return (<>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No enquiries yet" text="Consultation requests from the website appear here." />}>{(rows) => <Table rows={rows} onRow={setOpen} cols={[
      { header: 'From', cell: (e) => <div><p className="font-semibold">{e.name}</p><p className="text-xs text-gray-500">{e.phone}{e.email ? ' · ' + e.email : ''}</p></div> },
      { header: 'Topic', cell: (e) => e.topic }, { header: 'Country', cell: (e) => e.country }, { header: 'Received', cell: (e) => dateTime(e.created_at) },
      { header: 'Status', cell: (e) => <select className="input !w-auto !py-1 text-xs" value={e.status} onClick={(x) => x.stopPropagation()} onChange={(x) => setStatus(e, x.target.value)}>{['new', 'contacted', 'closed'].map((s) => <option key={s}>{s}</option>)}</select> },
    ]} />}</Async>
    {open && <EnquiryModal e={open} onClose={() => setOpen(null)} onSaved={q.reload} onDelete={async () => { if (await confirm({ title: 'Delete this enquiry?', text: 'This cannot be undone.', action: 'Delete', danger: true })) { await run(async () => { ok(await supabase.from('enquiries').delete().eq('id', open.id)) }, 'Enquiry deleted'); setOpen(null); q.reload() } }} />}
  </>)
}
function EnquiryModal({ e, onClose, onSaved, onDelete }: { e: Enq; onClose: () => void; onSaved: () => void; onDelete: () => void }) {
  const [notes, setNotes] = useState(e.notes ?? ''); const { run, busy } = useAction()
  return <Modal title={e.name} onClose={onClose}>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">{([['Phone', e.phone], ['Email', e.email], ['Country', e.country], ['Topic', e.topic], ['Preferred time', e.preferred_time], ['Received', dateTime(e.created_at)]] as [string, string | null][]).map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase text-gray-500">{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
    {e.message && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-brand-grey p-3 text-sm">{e.message}</p>}
    <div className="mt-4"><Field label="Internal notes"><textarea className="input" rows={3} maxLength={2000} value={notes} onChange={(x) => setNotes(x.target.value)} /></Field></div>
    <div className="mt-4 flex justify-between"><button className="btn-ghost text-red-700" onClick={onDelete}><Trash2 size={14} />Delete</button><button className="btn-primary" disabled={busy} onClick={async () => { await run(async () => { ok(await supabase.from('enquiries').update({ notes: clean(notes) || null }).eq('id', e.id)) }, 'Note saved'); onSaved() }}>Save note</button></div></Modal>
}

type Land = { id: string; name: string; region: string; plots: number | null; price_ghs: number | null; map_coords: string | null; note: string | null; status: string; featured: boolean; published: boolean; sort_order: number }
function Lands() {
  const q = useQuery(async () => ok(await supabase.from('land_listings').select('*').order('sort_order')) as Land[], [])
  const { run } = useAction(); const { confirm } = useFeedback(); const [form, setForm] = useState<Land | 'new' | null>(null)
  return (<>
    <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setForm('new')}><Plus size={15} />Add listing</button></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No land listings" />}>{(rows) => <Table rows={rows} cols={[
      { header: 'Listing', cell: (l) => <div><p className="font-semibold">{l.name}</p><p className="text-xs text-gray-500">{l.region}</p></div> }, { header: 'Plots', cell: (l) => l.plots ?? '—' }, { header: 'Price', cell: (l) => (l.price_ghs != null ? ghs(l.price_ghs) : 'On request') },
      { header: 'Status', cell: (l) => <Badge s={l.status} /> }, { header: 'Published', cell: (l) => (l.published ? 'Yes' : 'No') },
      { header: '', cell: (l) => <div className="flex gap-1"><button className="p-1 text-gray-500 hover:text-brand-green" aria-label="Edit" onClick={() => setForm(l)}><Pencil size={15} /></button>
        <button className="p-1 text-gray-500 hover:text-red-600" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete "${l.name}"?`, action: 'Delete', danger: true })) { await run(async () => { ok(await supabase.from('land_listings').delete().eq('id', l.id)) }, 'Listing deleted'); q.reload() } }}><Trash2 size={15} /></button></div> },
    ]} />}</Async>
    {form && <LandForm land={form === 'new' ? null : form} count={q.data?.length ?? 0} onClose={() => setForm(null)} onDone={() => { setForm(null); q.reload() }} />}
  </>)
}
function LandForm({ land, count, onClose, onDone }: { land: Land | null; count: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: land?.name ?? '', region: land?.region ?? '', plots: land?.plots != null ? String(land.plots) : '', price: land?.price_ghs != null ? String(land.price_ghs) : '', map_coords: land?.map_coords ?? '', note: land?.note ?? '', status: land?.status ?? 'available', featured: land?.featured ?? false, published: land?.published ?? true })
  const { run, busy } = useAction()
  const submit = async (e: FormEvent) => { e.preventDefault()
    const body = { name: clean(f.name), region: clean(f.region), plots: f.plots === '' ? null : Math.max(0, Math.round(num(f.plots))), price_ghs: f.price === '' ? null : Math.max(0, num(f.price)), map_coords: clean(f.map_coords) || null, note: clean(f.note) || null, status: f.status, featured: f.featured, published: f.published }
    const d = await run(async () => { const r = land ? await supabase.from('land_listings').update(body).eq('id', land.id) : await supabase.from('land_listings').insert({ ...body, sort_order: (count + 1) * 10 }); if (r.error) throw r.error }, 'Listing saved'); if (d) onDone() }
  return <Modal title={land ? 'Edit listing' : 'Add listing'} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><input className="input" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Region"><input className="input" required maxLength={80} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} /></Field>
      <Field label="Plots"><input className="input" type="number" min={0} value={f.plots} onChange={(e) => setF({ ...f, plots: e.target.value })} /></Field><Field label="Price (GHS)" hint="Leave empty for 'on request'."><input className="input" type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
      <Field label="Map coordinates"><input className="input" maxLength={60} value={f.map_coords} onChange={(e) => setF({ ...f, map_coords: e.target.value })} /></Field><Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="available">Available</option><option value="sold">Sold</option><option value="coming_soon">Coming soon</option></select></Field></div>
    <Field label="Note"><textarea className="input" rows={2} maxLength={400} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    <div className="flex gap-6 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} />Featured</label><label className="flex items-center gap-2"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} />Published on website</label></div>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div></form></Modal>
}

type Item = { id: string; title: string; image_url: string; status: string; kind: string; published: boolean; sort_order: number }
async function resizeJpeg(file: File) { // same approach as the previous admin: max 1600px, JPEG
  const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process image'))), 'image/jpeg', 0.86))
}
function Gallery() {
  const q = useQuery(async () => ok(await supabase.from('gallery_items').select('*').order('sort_order')) as Item[], [])
  const { run } = useAction(); const { confirm } = useFeedback(); const [add, setAdd] = useState(false)
  const set = (i: Item, body: Partial<Item>) => run(async () => { ok(await supabase.from('gallery_items').update(body).eq('id', i.id)) }).then(q.reload)
  return (<>
    <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setAdd(true)}><Plus size={15} />Add photo</button></div>
    <Async q={q} empty={(d) => d.length === 0 && <EmptyState title="No gallery photos" />}>{(rows) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((i) => (
      <div key={i.id} className="card !p-0 overflow-hidden"><img src={i.image_url} alt={i.title} loading="lazy" className="h-40 w-full object-cover" />
        <div className="space-y-2 p-3"><p className="truncate font-semibold">{i.title}</p>
          <div className="flex items-center gap-2"><select className="input !w-auto !py-1 text-xs" value={i.status} onChange={(e) => set(i, { status: e.target.value })}>{['Proposed', 'In progress', 'Completed'].map((s) => <option key={s}>{s}</option>)}</select>
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => set(i, { published: !i.published })}>{i.published ? <><Eye size={13} />Published</> : <><EyeOff size={13} />Hidden</>}</button>
            <button className="ml-auto p-1 text-gray-500 hover:text-red-600" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete "${i.title}"?`, action: 'Delete', danger: true })) { await run(async () => { ok(await supabase.from('gallery_items').delete().eq('id', i.id)); const m = i.image_url.match(/\/gallery\/([^?]+)$/); if (m) await supabase.storage.from('gallery').remove([decodeURIComponent(m[1]!)]) }, 'Photo deleted'); q.reload() } }}><Trash2 size={15} /></button></div></div></div>))}</div>}</Async>
    {add && <AddPhoto count={q.data?.length ?? 0} onClose={() => setAdd(false)} onDone={() => { setAdd(false); q.reload() }} />}
  </>)
}
function AddPhoto({ count, onClose, onDone }: { count: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', status: 'Proposed', kind: 'Photograph' }); const [file, setFile] = useState<File | null>(null); const { run, busy } = useAction(); const { toast } = useFeedback()
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Choose a JPG, PNG or WebP image.', 'err'); if (file.size > 26214400) return toast('That photo is too large. Choose one under 25 MB.', 'err')
    const d = await run(async () => {
      const slug = f.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'photo'; const name = `${Date.now()}-${slug}.jpg`
      const up = await supabase.storage.from('gallery').upload(name, await resizeJpeg(file), { contentType: 'image/jpeg', upsert: false }); if (up.error) throw up.error
      const url = supabase.storage.from('gallery').getPublicUrl(name).data.publicUrl
      const r = await supabase.from('gallery_items').insert({ title: clean(f.title), image_url: url, status: f.status, kind: clean(f.kind) || 'Photograph', sort_order: (count + 1) * 10 }); if (r.error) { await supabase.storage.from('gallery').remove([name]); throw r.error } }, 'Photo published'); if (d) onDone() }
  return <Modal title="Add gallery photo" onClose={onClose} small><form onSubmit={submit} className="space-y-4">
    <Field label="Title"><input className="input" required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Project status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['Proposed', 'In progress', 'Completed'].map((s) => <option key={s}>{s}</option>)}</select></Field><Field label="Type"><input className="input" maxLength={60} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} /></Field></div>
    <Field label="Photo"><input className="input" type="file" required accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
    <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !file}>{busy ? 'Uploading…' : 'Publish'}</button></div></form></Modal>
}

// ---------------------------------------------------------------- page text
// Elements on the public pages carry data-cms="key". The text in the page file is the default;
// a row in site_content overrides it. Saving here changes the live site immediately.
const PAGES: [string, string, string][] = [
  ['home', 'Home', 'index.html'], ['our-story', 'Our story', 'our-story.html'], ['mission-vision', 'Mission & vision', 'mission-vision.html'],
  ['our-team', 'Our team', 'our-team.html'], ['our-partners', 'Partners', 'our-partners.html'], ['contact', 'Contact', 'contact.html'],
  ['lands-for-sale', 'Lands for sale', 'lands-for-sale.html'], ['building-construction', 'Building & construction', 'building-construction.html'],
  ['construction-projects', 'Construction projects', 'construction-projects.html'], ['block-factory', 'Block factory', 'block-factory.html'],
  ['solar-installations', 'Solar installations', 'solar-installations.html'], ['solar-projects', 'Solar projects', 'solar-projects.html'], ['solar-village', 'Solar village', 'solar-village.html'],
  ['diaspora-land', 'Diaspora: land', 'diaspora-land.html'], ['diaspora-building', 'Diaspora: building', 'diaspora-building.html'], ['diaspora-solar', 'Diaspora: solar', 'diaspora-solar.html'],
  ['virtual-consultations', 'Virtual consultations', 'virtual-consultations.html'],
]
type TextItem = { key: string; tag: string; def: string; src?: string }
type Row = { key: string; value: string }

function PageText() {
  const [page, setPage] = useState('home'); const [find, setFind] = useState('')
  const file = PAGES.find((p) => p[0] === page)![2]
  const q = useQuery(async () => {
    const [html, rows] = await Promise.all([
      fetch('/' + file, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('Could not load the page'); return r.text() }),
      supabase.from('site_content').select('key, value').eq('page', page),
    ])
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const items: TextItem[] = [...doc.querySelectorAll('[data-cms],[data-cms-img]')].map((e) => e.hasAttribute('data-cms-img')
      ? { key: e.getAttribute('data-cms-img')!, tag: 'img', def: e.getAttribute('alt') ?? '', src: '/' + (e.getAttribute('src') ?? '') }
      : { key: e.getAttribute('data-cms')!, tag: e.tagName.toLowerCase(), def: (e.textContent ?? '').trim() })
    return { items, over: Object.fromEntries((ok(rows) as Row[]).map((r) => [r.key, r.value])) as Record<string, string> }
  }, [page])
  return (<>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select className="input !w-auto" value={page} onChange={(e) => setPage(e.target.value)}>{PAGES.map((p) => <option key={p[0]} value={p[0]}>{p[1]}</option>)}</select>
      <input className="input !w-auto min-w-[14rem]" placeholder="Search this page's text" value={find} onChange={(e) => setFind(e.target.value)} />
      <a className="btn-ghost text-sm" href={'https://eatl.co.com/' + (page === 'home' ? '' : file)} target="_blank" rel="noreferrer">View page</a>
    </div>
    <p className="mb-4 max-w-3xl text-sm text-gray-600">Change a heading or paragraph and press Save, or replace a photo (such as a team member's picture) with Upload new photo. It appears on the website straight away (visitors may need to refresh). Plain text only. Reset returns it to the original wording.</p>
    <Async q={q} empty={(d) => d.items.length === 0 && <EmptyState title="No editable text on this page" text="Choose another page." />}>{({ items, over }) => (
      <div className="space-y-3">{items.filter((i) => !find || (i.tag === 'img' ? i.def : over[i.key] ?? i.def).toLowerCase().includes(find.toLowerCase())).map((i) => i.tag === 'img' ? <ImageRow key={page + i.key} item={i} page={page} saved={over[i.key]} reload={q.reload} /> : <TextRow key={page + i.key} item={i} page={page} saved={over[i.key]} reload={q.reload} />)}</div>
    )}</Async>
  </>)
}

function TextRow({ item, page, saved, reload }: { item: TextItem; page: string; saved?: string; reload: () => void }) {
  const current = saved ?? item.def; const [v, setV] = useState(current); const { run, busy } = useAction()
  const dirty = v.trim() !== current.trim()
  const save = () => run(async () => {
    const value = clean(v)
    if (!value) throw new Error('Text cannot be empty')
    if (value === item.def) ok(await supabase.from('site_content').delete().eq('key', item.key))
    else ok(await supabase.from('site_content').upsert({ key: item.key, page, value }))
  }, 'Saved to the website').then(reload)
  const reset = () => run(async () => { ok(await supabase.from('site_content').delete().eq('key', item.key)) }, 'Restored original text').then(() => { setV(item.def); reload() })
  return (<div className="card p-3">
    <div className="mb-1 flex items-center gap-2 text-xs text-gray-500"><span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono uppercase">{item.tag}</span>{saved !== undefined && <Badge s="edited" />}</div>
    <textarea className="input" rows={item.tag === 'p' ? Math.min(8, Math.max(2, Math.ceil(v.length / 90))) : 2} maxLength={2000} value={v} onChange={(e) => setV(e.target.value)} />
    <div className="mt-2 flex items-center justify-end gap-2">
      {saved !== undefined && <button className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={reset}><Undo2 size={13} />Reset to original</button>}
      <button className="btn-primary !px-3 !py-1 text-xs" disabled={busy || !dirty || !v.trim()} onClick={save}>Save</button>
    </div></div>)
}

const SITE_IMG = '/storage/v1/object/public/gallery/'
function ImageRow({ item, page, saved, reload }: { item: TextItem; page: string; saved?: string; reload: () => void }) {
  const { run, busy } = useAction()
  const upload = (file: File | undefined) => file && run(async () => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP photo')
    if (file.size > 15 * 1024 * 1024) throw new Error('Photo is too large (15 MB maximum)')
    const name = `site/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const up = await supabase.storage.from('gallery').upload(name, await resizeJpeg(file), { contentType: 'image/jpeg', upsert: false }); if (up.error) throw up.error
    const url = supabase.storage.from('gallery').getPublicUrl(name).data.publicUrl
    const r = await supabase.from('site_content').upsert({ key: item.key, page, value: url })
    if (r.error) { await supabase.storage.from('gallery').remove([name]); throw r.error }
    if (saved) { const m = saved.match(/\/gallery\/(site\/[^?]+)$/); if (m) await supabase.storage.from('gallery').remove([m[1]!]) }
  }, 'Photo updated on the website').then(reload)
  const reset = () => run(async () => {
    ok(await supabase.from('site_content').delete().eq('key', item.key))
    const m = saved?.match(/\/gallery\/(site\/[^?]+)$/); if (m) await supabase.storage.from('gallery').remove([m[1]!])
  }, 'Restored original photo').then(reload)
  return (<div className="card flex items-center gap-4 p-3">
    <img src={saved ?? item.src} alt="" className="h-24 w-20 rounded-md bg-gray-100 object-cover" />
    <div className="min-w-0 flex-1"><div className="mb-1 flex items-center gap-2 text-xs text-gray-500"><span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono uppercase">photo</span>{saved !== undefined && <Badge s="edited" />}</div>
      <p className="truncate text-sm font-medium">{item.def || 'Photo'}</p>
      <p className="text-xs text-gray-500">JPG, PNG or WebP. Resized automatically. Use a similar shape to the current photo.</p></div>
    <div className="flex flex-col gap-2">
      <label className={`btn-primary !px-3 !py-1 text-xs ${busy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>Upload new photo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} /></label>
      {saved !== undefined && <button className="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onClick={reset}><Undo2 size={13} />Reset to original</button>}
    </div></div>)
}
