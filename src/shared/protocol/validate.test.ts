import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, fromUnixSeconds, isIsoDate, secondsUntilUtcMidnight, toUnixSeconds } from './dates.js'
import { ConnectorError } from './errors.js'
import { requestIdOf, validateRequest } from './validate.js'

const NOW = new Date('2026-10-26T12:00:00Z')

function errorOf(input: unknown): ConnectorError {
  try {
    validateRequest(input, NOW)
  } catch (e) {
    if (e instanceof ConnectorError) return e
    throw e
  }
  throw new Error('expected the request to be refused')
}

describe('dates', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-10-26')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-1-5')).toBe(false)
    expect(isIsoDate('2026-10-26T00:00:00Z')).toBe(false)
    expect(isIsoDate(20261026)).toBe(false)
  })

  it('does day arithmetic in UTC', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-01', '2026-10-26')).toBe(25)
    expect(fromUnixSeconds(toUnixSeconds('2026-10-23'))).toBe('2026-10-23')
    expect(secondsUntilUtcMidnight(new Date('2026-10-26T23:59:00Z'))).toBe(60)
  })
})

describe('validateRequest', () => {
  it('accepts hello and openSettings without params', () => {
    expect(validateRequest({ v: 1, id: 'a1', op: 'hello' }, NOW)).toEqual({ id: 'a1', op: 'hello' })
    expect(validateRequest({ v: 1, id: 'a2', op: 'openSettings', params: {} }, NOW)).toEqual({ id: 'a2', op: 'openSettings' })
  })

  it('accepts a search and trims the query', () => {
    expect(validateRequest({ v: 1, id: 'r', op: 'search', params: { provider: 'eodhd', query: '  tesco ' } }, NOW)).toEqual({
      id: 'r',
      op: 'search',
      params: { provider: 'eodhd', query: 'tesco' },
    })
  })

  it('accepts a history request and caps "to" at tomorrow', () => {
    const req = validateRequest(
      { v: 1, id: 'h', op: 'history', params: { provider: 'twelvedata', symbol: 'BTC/USD:Coinbase Pro', from: '2026-01-01', to: '2030-01-01' } },
      NOW,
    )
    expect(req).toEqual({
      id: 'h',
      op: 'history',
      params: { provider: 'twelvedata', symbol: 'BTC/USD:Coinbase Pro', from: '2026-01-01', to: '2026-10-27' },
    })
  })

  it('accepts the ticker shapes providers use', () => {
    for (const symbol of ['AAPL.US', 'BRK-B.US', 'M&M.NSE', 'SE0021021417.EUFUND', 'OANDA:EUR_USD', '^GSPC', 'TSCO.LON']) {
      expect(() => validateRequest({ v: 1, id: 'h', op: 'history', params: { provider: 'eodhd', symbol, from: '2026-01-01' } }, NOW)).not.toThrow()
    }
  })

  it('refuses another protocol version', () => {
    expect(errorOf({ v: 2, id: 'x', op: 'hello' }).code).toBe('UNSUPPORTED_PROTOCOL')
    expect(errorOf({ id: 'x', op: 'hello' }).code).toBe('UNSUPPORTED_PROTOCOL')
  })

  it('refuses unknown operations', () => {
    expect(errorOf({ v: 1, id: 'x', op: 'fetchUrl' }).code).toBe('UNSUPPORTED_OPERATION')
  })

  it('refuses malformed envelopes and params without echoing them', () => {
    const cases: unknown[] = [
      null,
      'hello',
      [],
      { v: 1, op: 'hello' },
      { v: 1, id: 'bad id!', op: 'hello' },
      { v: 1, id: 'x'.repeat(65), op: 'hello' },
      { v: 1, id: 'x', op: 'search', params: { provider: 'Yahoo!', query: 'a' } },
      { v: 1, id: 'x', op: 'search', params: { provider: 'x', query: 'a' } },
      { v: 1, id: 'x', op: 'search', params: { provider: 'eodhd', query: '' } },
      { v: 1, id: 'x', op: 'search', params: { provider: 'eodhd', query: 'a'.repeat(65) } },
      { v: 1, id: 'x', op: 'search', params: { provider: 'eodhd', query: 'line\nbreak' } },
      { v: 1, id: 'x', op: 'search', params: { provider: 'eodhd', query: '..' } },
      { v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: '..', from: '2026-01-01' } },
      { v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: 'https://evil.example/x', from: '2026-01-01' } },
      { v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-02-30' } },
      { v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '1850-01-01' } },
      { v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2027-01-01' } },
      { v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-05-01', to: '2026-04-01' } },
    ]
    for (const input of cases) {
      const e = errorOf(input)
      expect(e.code).toBe('BAD_REQUEST')
      expect(e.message).not.toContain('evil')
    }
  })

  it('keeps a usable request id for the answer', () => {
    expect(requestIdOf({ id: 'abc-1' })).toBe('abc-1')
    expect(requestIdOf({ id: '<script>' })).toBe('')
    expect(requestIdOf(null)).toBe('')
  })
})
