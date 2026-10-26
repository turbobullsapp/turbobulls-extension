/** Calendar-date helpers. Every date in the protocol is a plain YYYY-MM-DD string, read as UTC. */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function todayUtc(now: Date = new Date()): string {
  return toIsoDate(now)
}

export function addDays(isoDate: string, days: number): string {
  return toIsoDate(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS))
}

/** Seconds since the epoch at 00:00 UTC of this date. */
export function toUnixSeconds(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000)
}

export function fromUnixSeconds(seconds: number): string {
  return toIsoDate(new Date(seconds * 1000))
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/** Seconds from now until the next 00:00 UTC, when most providers reset a daily allowance. */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}
