import { useEffect, useState } from 'react'
import { Camera, Check, Circle, Clock } from 'lucide-react'
import type { Milestone, ProjectUpdate } from '../lib/types'
import { signedUrl } from '../lib/files'
import { date, dateTime } from '../lib/format'

export function MilestoneTracker({ items }: { items: Milestone[] }) {
  const sorted = [...items].sort((a, b) => a.position - b.position)
  const current = sorted.find((m) => m.status === 'current')
  return (
    <div>
      {current && <p className="mb-3 rounded-lg bg-brand-green/10 px-3 py-2 text-sm"><span className="font-semibold text-brand-green">Current stage:</span> {current.title}</p>}
      <ol className="relative space-y-0">
        {sorted.map((m, i) => (
          <li key={m.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < sorted.length - 1 && <span className={`absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5 ${m.status === 'completed' ? 'bg-brand-green' : 'bg-gray-200'}`} aria-hidden="true" />}
            <span className={`z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${m.status === 'completed' ? 'border-brand-green bg-brand-green text-white' : m.status === 'current' ? 'border-brand-yellow bg-brand-yellow text-brand-black' : 'border-gray-300 bg-white text-gray-400'}`}>
              {m.status === 'completed' ? <Check size={14} /> : m.status === 'current' ? <Clock size={14} /> : <Circle size={8} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${m.status === 'upcoming' ? 'text-gray-500' : 'text-brand-black'}`}>{m.title}</p>
              <p className="text-xs text-gray-500">
                {m.status === 'completed' ? `Completed ${date(m.completed_at)}` : m.status === 'current' ? 'In progress' : 'Upcoming'}
                {m.due_date && m.status !== 'completed' ? ` · due ${date(m.due_date)}` : ''}
              </p>
              {m.description && <p className="mt-0.5 text-xs text-gray-600">{m.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Photo({ path, className = '' }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { signedUrl('project-photos', path).then(setUrl).catch(() => setUrl(null)) }, [path])
  if (!url) return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />
  return <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Project progress" loading="lazy" className={`rounded-lg object-cover ${className}`} /></a>
}

export function UpdatesTimeline({ items, showAuthor }: { items: ProjectUpdate[]; showAuthor?: boolean }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-gray-500">No progress updates yet.</p>
  return (
    <ul className="space-y-4">
      {items.map((u) => (
        <li key={u.id} className="rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p className="font-semibold text-brand-black">{u.title}</p>
            <p className="text-xs text-gray-500">{dateTime(u.created_at)}{showAuthor && u.profiles?.full_name ? ` · ${u.profiles.full_name}` : ''}{!u.visible_to_client && ' · internal'}</p>
          </div>
          {u.body && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{u.body}</p>}
          {u.photo_paths.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {u.photo_paths.map((p) => <Photo key={p} path={p} className="h-24 w-full sm:h-28" />)}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
export const PhotoBadge = () => <Camera size={14} />
