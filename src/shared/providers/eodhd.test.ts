import { beforeEach, describe, expect, it } from 'vitest'
import { all, fakeFetch, path, pathStarts, query, TEST_KEY } from '../__fixtures__/fake-fetch.js'
import { ConnectorError } from '../protocol/errors.js'
import { clearEodhdCurrencyCache, eodhd, repairMojibake, splitEodhdSymbol } from './eodhd.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')

// Shapes as EODHD sends them (AAPL around its 4:1 split on 2020-08-31, and a normal week).
const AAPL_EOD = [
  { date: '2020-08-28', open: 504.05, high: 505.77, low: 498.31, close: 499.23, adjusted_close: 120.9557, volume: 187630000 },
  { date: '2020-08-31', open: 127.58, high: 131, low: 126, close: 129.04, adjusted_close: 125.0575, volume: 225702700 },
]
const TESCO_SEARCH = [
  { Code: 'TSCO', Exchange: 'LSE', Name: 'Tesco PLC', Type: 'Common Stock', Country: 'UK', Currency: 'GBX', ISIN: 'GB00BLGZ9862' },
  { Code: 'TSCDY', Exchange: 'US', Name: 'Tesco PLC ADR', Type: 'Common Stock', Country: 'USA', Currency: 'USD', ISIN: null },
]

function ctx(fetch: ReturnType<typeof fakeFetch>['fetch']) {
  return { apiKey: TEST_KEY, fetch, now: NOW }
}

beforeEach(() => clearEodhdCurrencyCache())

describe('eodhd helpers', () => {
  it('splits a symbol at the last dot', () => {
    expect(splitEodhdSymbol('AAPL.US')).toEqual({ code: 'AAPL', exchange: 'US' })
    expect(splitEodhdSymbol('BRK.B.US')).toEqual({ code: 'BRK.B', exchange: 'US' })
    expect(() => splitEodhdSymbol('AAPL')).toThrow(ConnectorError)
    expect(() => splitEodhdSymbol('AAPL.')).toThrow(ConnectorError)
  })

  it('repairs a double-encoded fund name and leaves clean names alone', () => {
    // Verbatim what EODHD sends for SE0021021417.
    expect(repairMojibake('Avanza RÃ¤nta Global')).toBe('Avanza Ränta Global')
    expect(repairMojibake('Avanza Ränta Global')).toBe('Avanza Ränta Global')
    expect(repairMojibake('Plain Name')).toBe('Plain Name')
  })
})

describe('eodhd.history', () => {
  it('sends the key as a bearer token, never in the URL, and keeps as-traded closes', async () => {
    const { fetch, calls } = fakeFetch([{ match: path('/api/eod/AAPL.US'), body: AAPL_EOD }])
    const answer = await eodhd.history('AAPL.US', '2020-08-01', '2020-09-30', ctx(fetch))
    expect(answer).toEqual({
      symbol: 'AAPL.US',
      currency: 'USD',
      prices: [
        { date: '2020-08-28', close: 499.23 },
        { date: '2020-08-31', close: 129.04 },
      ],
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.headers.Authorization).toBe(`Bearer ${TEST_KEY}`)
    expect(call.url.toString()).not.toContain(TEST_KEY)
    expect(call.url.searchParams.get('from')).toBe('2020-08-01')
    expect(call.url.searchParams.get('to')).toBe('2020-09-30')
    expect(call.url.searchParams.get('order')).toBe('a')
  })

  it('looks the currency up once, and turns London pence into pounds', async () => {
    const { fetch, calls } = fakeFetch([
      { match: all(path('/api/search/TSCO'), query('exchange', 'LSE')), body: TESCO_SEARCH },
      { match: path('/api/eod/TSCO.LSE'), body: [{ date: '2026-10-23', close: 357.4 }] },
    ])
    const first = await eodhd.history('TSCO.LSE', '2026-10-20', '2026-10-24', ctx(fetch))
    expect(first).toEqual({ symbol: 'TSCO.LSE', currency: 'GBP', prices: [{ date: '2026-10-23', close: 3.574 }] })
    await eodhd.history('TSCO.LSE', '2026-10-20', '2026-10-24', ctx(fetch))
    expect(calls.filter((c) => c.url.pathname.startsWith('/api/search/'))).toHaveLength(1)
  })

  it('takes forex and crypto currencies from the pair itself', async () => {
    const { fetch, calls } = fakeFetch([
      { match: pathStarts('/api/eod/'), body: [{ date: '2026-10-23', close: 1.16 }] },
    ])
    expect((await eodhd.history('EURUSD.FOREX', '2026-10-20', '2026-10-24', ctx(fetch))).currency).toBe('USD')
    expect((await eodhd.history('BTC-EUR.CC', '2026-10-20', '2026-10-24', ctx(fetch))).currency).toBe('EUR')
    expect(calls.every((c) => c.url.pathname.startsWith('/api/eod/'))).toBe(true)
  })

  it('reports a symbol EODHD does not list with its currency as not found', async () => {
    const { fetch } = fakeFetch([{ match: pathStarts('/api/search/'), body: [] }])
    await expect(eodhd.history('NOPE.XETRA', '2026-10-01', '2026-10-24', ctx(fetch))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it.each([
    [401, 'Unauthenticated', 'INVALID_KEY'],
    [402, 'Payment required', 'RATE_LIMITED'],
    [403, 'Forbidden', 'PLAN_LIMIT'],
    [404, 'Ticker Not Found.', 'NOT_FOUND'],
    [429, 'Too Many Requests', 'RATE_LIMITED'],
    [502, 'Bad Gateway', 'PROVIDER_ERROR'],
  ])('maps HTTP %i to %s', async (status, text, code) => {
    const { fetch } = fakeFetch([{ match: pathStarts('/api/eod/'), status, text }])
    const err = await eodhd.history('AAPL.US', '2026-10-01', '2026-10-24', ctx(fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectorError)
    expect((err as ConnectorError).code).toBe(code)
    expect((err as ConnectorError).message).not.toContain(TEST_KEY)
    if (status === 402) expect((err as ConnectorError).retryAfter).toBe(12 * 3600)
  })

  it('reads the Retry-After header on a 429', async () => {
    const { fetch } = fakeFetch([{ match: pathStarts('/api/eod/'), status: 429, text: 'slow down', headers: { 'Retry-After': '17' } }])
    await expect(eodhd.history('AAPL.US', '2026-10-01', '2026-10-24', ctx(fetch))).rejects.toMatchObject({ retryAfter: 17 })
  })

  it('treats a range with no trading days as empty, not as an error', async () => {
    const { fetch } = fakeFetch([{ match: pathStarts('/api/eod/'), body: [] }])
    expect((await eodhd.history('AAPL.US', '2026-10-24', '2026-10-25', ctx(fetch))).prices).toEqual([])
  })
})

describe('eodhd.search', () => {
  it('returns symbols ready for history, in major currencies', async () => {
    const { fetch, calls } = fakeFetch([{ match: path('/api/search/tesco'), body: TESCO_SEARCH }])
    const results = await eodhd.search('tesco', ctx(fetch))
    expect(results).toEqual([
      { symbol: 'TSCO.LSE', name: 'Tesco PLC', exchange: 'LSE', currency: 'GBP', type: 'Common Stock', isin: 'GB00BLGZ9862' },
      { symbol: 'TSCDY.US', name: 'Tesco PLC ADR', exchange: 'US', currency: 'USD', type: 'Common Stock' },
    ])
    expect(calls[0]!.url.toString()).not.toContain(TEST_KEY)
  })

  it('refuses an answer that is not a list', async () => {
    const { fetch } = fakeFetch([{ match: pathStarts('/api/search/'), body: { unexpected: true } }])
    await expect(eodhd.search('tesco', ctx(fetch))).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})
