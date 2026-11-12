export const MIN_PASSWORD = 10
export function passwordIssue(p: string): string | null {
  if (p.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Include both letters and numbers.'
  if (/^(.)\1+$/.test(p) || /password|12345678|qwerty/i.test(p)) return 'That password is too easy to guess.'
  return null
}
export function strength(p: string) {
  let s = 0
  if (p.length >= MIN_PASSWORD) s++
  if (p.length >= 14) s++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++
  if (/[0-9]/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return Math.min(s, 4)
}

export const PWNED_MESSAGE = 'This password has appeared in a known data breach. Please choose a different one.'
// Checks the free Have I Been Pwned list. Only the first 5 characters of the password's SHA-1 hash leave the browser
// (k-anonymity); the password itself is never sent. If the check cannot run, the password is allowed.
export async function isPwned(p: string): Promise<boolean> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(p))
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000)
    const r = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0, 5), { headers: { 'Add-Padding': 'true' }, signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return false
    const suffix = hex.slice(5)
    return (await r.text()).split('\n').some((l) => { const [h, c] = l.trim().split(':'); return h === suffix && Number(c) > 0 })
  } catch { return false }
}
