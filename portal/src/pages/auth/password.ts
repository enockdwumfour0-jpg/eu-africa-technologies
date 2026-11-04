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
