import { beforeEach, describe, expect, it } from 'vitest'
import { fakeFetch, path, TEST_KEY } from '../__fixtures__/fake-fetch.js'
import { toUnixSeconds } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import { clearFinnhubCurrencyCache, finnhub } from './finnhub.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')
const ctx = (fetch: ReturnType<typeof fakeFetch>['fetch']) => ({ apiKey: TEST_KEY, fetch, now: NOW })

const CANDLES = {
  c: [346.5, 347.73],
  h: [348.2, 351.73],
  l: [343.0, 345.75],
  o: [344.1, 349.12],
  s: 'ok',
  t: [toUnixSeconds('2026-10-22') + 48_600, toUnixSeconds('2026-10-23') + 48_600],
  v: [30100000, 39496500],
}

beforeEach(() => clearFinnhubCurrencyCache())

describe('finnhub.history', () => {
  it('reads daily candles with the key in a header and the currency from the profile', async () => {
    const { fetch, calls } = fakeFetch([
      { match: path('/api/v1/stock/profile2'), body: { currency: 'USD', name: 'Apple Inc' } },
      { match: path('/api/v1/stock/candle'), body: CANDLES },
    ])
    const answer = await finnhub.history('AAPL', '2026-10-20', '2026-10-23', ctx(fetch))
    expect(answer).toEqual({
      symbol: 'AAPL',
      currency: 'USD',
      prices: [
        { date: '2026-10-22', close: 346.5 },
        { date: '2026-10-23', close: 347.73 },
      ],
    })
    for (const call of calls) {
      expect(call.headers['X-Finnhub-Token']).toBe(TEST_KEY)
      expect(call.url.toString()).not.toContain(TEST_KEY)
    }
    const candle = calls.find((c) => c.url.pathname.endsWith('/candle'))!
    expect(candle.url.searchParams.get('resolution')).toBe('D')
    expect(candle.url.searchParams.get('from')).toBe(String(toUnixSeconds('2026-10-20')))
  })

  it('prices a plain US ticker in dollars when the plan has no profiles', async () => {
    const { fetch } = fakeFetch([
      { match: path('/api/v1/stock/profile2'), status: 403, body: { error: "You don't have access to this resource." } },
      { match: path('/api/v1/stock/candle'), body: CANDLES },
    ])
    expect((await finnhub.history('AAPL', '2026-10-20', '2026-10-23', ctx(fetch))).currency).toBe('USD')
  })

  it('refuses to guess the currency of a foreign listing', async () => {
    const { fetch } = fakeFetch([{ match: path('/api/v1/stock/profile2'), body: {} }])
    await expect(finnhub.history('TSCO.L', '2026-10-20', '2026-10-23', ctx(fetch))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('treats no_data as an empty range', async () => {
    const { fetch } = fakeFetch([
      { match: path('/api/v1/stock/profile2'), body: { currency: 'USD' } },
      { match: path('/api/v1/stock/candle'), body: { s: 'no_data' } },
    ])
    expect((await finnhub.history('AAPL', '2026-10-24', '2026-10-25', ctx(fetch))).prices).toEqual([])
  })

  it.each([
    [401, { error: 'Invalid API key.' }, 'INVALID_KEY'],
    [403, { error: "You don't have access to this resource." }, 'PLAN_LIMIT'],
    [429, { error: 'API limit reached.' }, 'RATE_LIMITED'],
    [500, {}, 'PROVIDER_ERROR'],
  ])('maps HTTP %i on candles', async (status, body, code) => {
    const { fetch } = fakeFetch([
      { match: path('/api/v1/stock/profile2'), body: { currency: 'USD' } },
      { match: path('/api/v1/stock/candle'), status, body },
    ])
    const err = await finnhub.history('AAPL', '2026-10-20', '2026-10-23', ctx(fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectorError)
    expect((err as ConnectorError).code).toBe(code)
  })
})

describe('finnhub.search', () => {
  it('returns symbols ready for history', async () => {
    const { fetch } = fakeFetch([
      {
        match: path('/api/v1/search'),
        body: { count: 1, result: [{ description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' }] },
      },
    ])
    expect(await finnhub.search('apple', ctx(fetch))).toEqual([{ symbol: 'AAPL', name: 'APPLE INC', type: 'Common Stock' }])
  })
})
