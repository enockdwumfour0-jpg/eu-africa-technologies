import { supabase } from './supabase'

export const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg', 'image/png': 'png',
}
export const ACCEPT = '.pdf,.docx,.xlsx,.jpg,.jpeg,.png'
export const IMAGES = { 'image/jpeg': 'jpg', 'image/png': 'png' } as Record<string, string>

// Client-side pre-check for friendlier errors. The bucket enforces type and size server-side too.
export function checkFile(f: File, opts: { images?: boolean; maxMB?: number } = {}): string | null {
  const types = opts.images ? IMAGES : ALLOWED
  if (!types[f.type]) return opts.images ? 'Use a JPG or PNG image.' : 'Allowed files: PDF, DOCX, XLSX, JPG, PNG.'
  if (f.size > (opts.maxMB ?? 20) * 1048576) return `File is larger than ${opts.maxMB ?? 20} MB.`
  if (f.size === 0) return 'File is empty.'
  return null
}
export const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)

export async function upload(bucket: string, folder: string, f: File) {
  const path = `${folder}/${crypto.randomUUID()}-${safeName(f.name)}`
  const { error } = await supabase.storage.from(bucket).upload(path, f, { contentType: f.type, upsert: false })
  if (error) throw error
  return path
}
const cache = new Map<string, { url: string; exp: number }>()
export async function signedUrl(bucket: string, path: string, download?: string) {
  const k = bucket + '/' + path + (download ?? '')
  const hit = cache.get(k)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300, download ? { download } : undefined)
  if (error || !data) throw error ?? new Error('Could not create link')
  cache.set(k, { url: data.signedUrl, exp: Date.now() + 240_000 })
  return data.signedUrl
}
export async function openFile(bucket: string, path: string, download?: string) {
  window.open(await signedUrl(bucket, path, download), '_blank', 'noopener')
}
