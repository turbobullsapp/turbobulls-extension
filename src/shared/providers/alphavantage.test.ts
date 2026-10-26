import { beforeEach, describe, expect, it } from 'vitest'
import { fakeFetch, query, TEST_KEY } from '../__fixtures__/fake-fetch.js'
import { ConnectorError } from '../protocol/errors.js'
import { alphavantage, clearAlphaVantageCurrencyCache } from './alphavantage.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')
const ctx = (fetch: ReturnType<typeof fakeFetch>['fetch']) => ({ apiKey: TEST_KEY, fetch, now: NOW })

const IBM_DAILY = {
  'Meta Data': { '1. Information': 'Daily Prices (open, high, low, close) and Volumes', '2. Symbol': 'IBM' },
  'Time Series (Daily)': {
    '2026-10-23': { '1. open': '250.1', '2. high': '252.0', '3. low': '249.5', '4. close': '251.32', '5. volume': '3000000' },
    '2026-10-22': { '1. open': '248.0', '2. high': '250.5', '3. low': '247.9', '4. close': '249.87', '5. volume': '2800000' },
  },
}
const TESCO_SEARCH = {
  bestMatches: [
    { '1. symbol': 'TSCO.LON', '2. name': 'Tesco PLC', '3. type': 'Equity', '4. region': 'United Kingdom', '8. currency': 'GBX', '9. matchScore': '0.7273' },
  ],
}

beforeEach(() => clearAlphaVantageCurrencyCache())

describe('alphavantage.history', () => {
  it('reads the daily series and prices a US listing in dollars without a lookup', async () => {
    const { fetch, calls } = fakeFetch([{ match: query('function', 'TIME_SERIES_DAILY'), body: IBM_DAILY }])
    const answer = await alphavantage.history('IBM', '2026-10-20', '2026-10-24', ctx(fetch))
    expect(answer).toEqual({
      symbol: 'IBM',
      currency: 'USD',
      prices: [
        { date: '2026-10-22', close: 249.87 },
        { date: '2026-10-23', close: 251.32 },
      ],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.searchParams.get('outputsize')).toBe('compact')
  })

  it('asks for the full series only when the range goes back past about 100 trading days', async () => {
    const { fetch, calls } = fakeFetch([{ match: query('function', 'TIME_SERIES_DAILY'), body: IBM_DAILY }])
    await alphavantage.history('IBM', '2020-01-01', '2026-10-24', ctx(fetch))
    expect(calls[0]!.url.searchParams.get('outputsize')).toBe('full')
  })

  it('falls back to the latest 100 days when the plan refuses the full series', async () => {
    const { fetch, calls } = fakeFetch([
      {
        match: (u) => u.searchParams.get('outputsize') === 'full',
        body: { Information: 'Thank you for using Alpha Vantage! This is a premium endpoint.' },
      },
      { match: query('outputsize', 'compact'), body: IBM_DAILY },
    ])
    const answer = await alphavantage.history('IBM', '2020-01-01', '2026-10-24', ctx(fetch))
    expect(answer.prices).toHaveLength(2)
    expect(calls.map((c) => c.url.searchParams.get('outputsize'))).toEqual(['full', 'compact'])
  })

  it('looks up the currency of a foreign listing and turns pence into pounds', async () => {
    const { fetch } = fakeFetch([
      { match: query('function', 'SYMBOL_SEARCH'), body: TESCO_SEARCH },
      {
        match: query('function', 'TIME_SERIES_DAILY'),
        body: { 'Time Series (Daily)': { '2026-10-23': { '4. close': '357.4000' } } },
      },
    ])
    expect(await alphavantage.history('TSCO.LON', '2026-10-20', '2026-10-24', ctx(fetch))).toEqual({
      symbol: 'TSCO.LON',
      currency: 'GBP',
      prices: [{ date: '2026-10-23', close: 3.574 }],
    })
  })

  it.each([
    [{ 'Error Message': 'Invalid API call. Please retry or visit the documentation for TIME_SERIES_DAILY.' }, 'NOT_FOUND'],
    [{ 'Error Message': 'the parameter apikey is invalid or missing.' }, 'INVALID_KEY'],
    [{ Information: 'We have detected your API key as XYZ and our standard API rate limit is 25 requests per day.' }, 'RATE_LIMITED'],
    [{ Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.' }, 'RATE_LIMITED'],
    [{ Information: 'This is a premium endpoint.' }, 'PLAN_LIMIT'],
  ])('maps %o', async (body, code) => {
    const { fetch } = fakeFetch([{ match: query('function', 'TIME_SERIES_DAILY'), body }])
    const err = await alphavantage.history('IBM', '2026-10-20', '2026-10-24', ctx(fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectorError)
    expect((err as ConnectorError).code).toBe(code)
  })

  it('never puts the key into an error message, though the URL carries it', async () => {
    const { fetch, calls } = fakeFetch([{ match: query('function', 'TIME_SERIES_DAILY'), status: 503, text: 'down' }])
    const err = (await alphavantage.history('IBM', '2026-10-20', '2026-10-24', ctx(fetch)).catch((e: unknown) => e)) as ConnectorError
    expect(calls[0]!.url.searchParams.get('apikey')).toBe(TEST_KEY)
    expect(err.message).not.toContain(TEST_KEY)
    expect(err.message).not.toContain('alphavantage.co')
  })
})

describe('alphavantage.search', () => {
  it('returns symbols with major currencies', async () => {
    const { fetch } = fakeFetch([{ match: query('function', 'SYMBOL_SEARCH'), body: TESCO_SEARCH }])
    expect(await alphavantage.search('tesco', ctx(fetch))).toEqual([
      { symbol: 'TSCO.LON', name: 'Tesco PLC', exchange: 'United Kingdom', currency: 'GBP', type: 'Equity' },
    ])
  })
})
