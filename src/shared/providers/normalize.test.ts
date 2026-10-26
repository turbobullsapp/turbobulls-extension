import { describe, expect, it } from 'vitest'
import { toMajor } from './currency.js'
import { retryAfterSeconds } from './http.js'
import { createLimiter } from './limiter.js'
import { finalizeSeries } from './series.js'

describe('toMajor', () => {
  it('turns pence, cents and agorot into their major currency', () => {
    expect(toMajor('GBp')).toEqual({ currency: 'GBP', divisor: 100 })
    expect(toMajor('GBX')).toEqual({ currency: 'GBP', divisor: 100 })
    expect(toMajor('ZAc')).toEqual({ currency: 'ZAR', divisor: 100 })
    expect(toMajor('ILA')).toEqual({ currency: 'ILS', divisor: 100 })
  })

  it('keeps major currencies as they are, GBP included', () => {
    expect(toMajor('GBP')).toEqual({ currency: 'GBP', divisor: 1 })
    expect(toMajor('USD')).toEqual({ currency: 'USD', divisor: 1 })
    expect(toMajor('sek')).toEqual({ currency: 'SEK', divisor: 1 })
  })

  it('has no currency for empty or unknown values', () => {
    expect(toMajor('NA')).toBeUndefined()
    expect(toMajor('')).toBeUndefined()
    expect(toMajor('US Dollar')).toBeUndefined()
    expect(toMajor(undefined)).toBeUndefined()
    expect(toMajor(840)).toBeUndefined()
  })
})

describe('finalizeSeries', () => {
  it('keeps real days in range, ascending, one per day, divided into major units', () => {
    const rows = [
      { date: '2026-10-09', close: '430.29999' },
      { date: '2026-10-08 00:00:00', close: 428 },
      { date: '2026-10-07', close: 'NA' },
      { date: '2026-10-06', close: 0 },
      { date: '2026-10-05', close: -3 },
      { date: '2026-02-30', close: 10 },
      { date: '2026-09-30', close: 5 },
      { date: '2026-10-10', close: 9 },
      { date: '2026-10-08', close: 429 },
    ]
    expect(finalizeSeries(rows, { from: '2026-10-01', to: '2026-10-09', divisor: 100 })).toEqual([
      { date: '2026-10-08', close: 4.29 },
      { date: '2026-10-09', close: 4.3029999 },
    ])
  })

  it('keeps the newest points when there are more than the protocol allows', () => {
    const rows = Array.from({ length: 20_005 }, (_, i) => ({
      date: new Date(Date.UTC(1950, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      close: i + 1,
    }))
    const out = finalizeSeries(rows, { from: '1900-01-01', to: '2100-01-01', divisor: 1 })
    expect(out).toHaveLength(20_000)
    expect(out[0]?.close).toBe(6)
  })
})

describe('retryAfterSeconds', () => {
  const headers = (value: string | null) => ({ get: () => value })
  it('reads seconds or an HTTP date, else falls back', () => {
    expect(retryAfterSeconds(headers('30'), 60)).toBe(30)
    expect(retryAfterSeconds(headers('Mon, 26 Oct 2026 12:01:00 GMT'), 60, Date.parse('2026-10-26T12:00:00Z'))).toBe(60)
    expect(retryAfterSeconds(headers(null), 60)).toBe(60)
    expect(retryAfterSeconds(headers('soon'), 60)).toBe(60)
  })
})

describe('createLimiter', () => {
  it('runs one task at a time, in order, even when one fails', async () => {
    const run = createLimiter(0)
    const order: string[] = []
    const slow = run(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push('slow')
    })
    const failing = run(async () => {
      order.push('failing')
      throw new Error('boom')
    })
    const fast = run(async () => {
      order.push('fast')
      return 3
    })
    await slow
    await expect(failing).rejects.toThrow('boom')
    expect(await fast).toBe(3)
    expect(order).toEqual(['slow', 'failing', 'fast'])
  })

  it('waits the minimum gap between calls', async () => {
    const waits: number[] = []
    const run = createLimiter(1000, async (ms) => {
      waits.push(ms)
    })
    await run(async () => 1)
    await run(async () => 2)
    expect(waits).toHaveLength(1)
    expect(waits[0]).toBeGreaterThan(900)
  })
})
