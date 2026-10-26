import { isIsoDate } from '../protocol/dates.js'
import { LIMITS, type PricePoint } from '../protocol/types.js'

export interface RawRow {
  date: unknown
  close: unknown
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

/** Drop the floating-point noise a division leaves (430.29999 / 100 = 4.3029999000000005). */
function tidy(value: number): number {
  return Number(value.toPrecision(12))
}

/**
 * Turn a provider's rows into the protocol's price list: real dates within [from, to], finite
 * closes above zero, divided into major units, one point per day, ascending, at most
 * LIMITS.historyPoints (the newest kept).
 */
export function finalizeSeries(
  rows: readonly RawRow[],
  opts: { from: string; to: string; divisor: number },
): PricePoint[] {
  const byDate = new Map<string, number>()
  for (const row of rows) {
    const date = typeof row.date === 'string' ? row.date.slice(0, 10) : undefined
    if (!isIsoDate(date) || date < opts.from || date > opts.to) continue
    const close = toNumber(row.close)
    if (!Number.isFinite(close) || close <= 0) continue
    byDate.set(date, tidy(close / opts.divisor))
  }
  const points = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }))
  return points.length > LIMITS.historyPoints ? points.slice(points.length - LIMITS.historyPoints) : points
}
