import { describe, expect, it } from 'vitest'
import { fakeFetch, path, TEST_KEY } from '../__fixtures__/fake-fetch.js'
import { ConnectorError } from '../protocol/errors.js'
import { splitTwelveDataSymbol, twelvedata } from './twelvedata.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')
const ctx = (fetch: ReturnType<typeof fakeFetch>['fetch']) => ({ apiKey: TEST_KEY, fetch, now: NOW })

// Twelve Data's raw HTTP shapes (snake_case), newest first.
const AAPL_SERIES = {
  meta: { symbol: 'AAPL', interval: '1day', currency: 'USD', exchange: 'NASDAQ', mic_code: 'XNGS', type: 'Common Stock' },
  values: [
    { datetime: '2026-10-23', open: '349.12000', high: '351.73001', low: '345.75', close: '347.73001', volume: '39496500' },
    { datetime: '2026-10-22', open: '344.1', high: '348.2', low: '343.0', close: '346.5', volume: '30100000' },
  ],
  status: 'ok',
}
// Barclays on 2026-10-09: 430.29999 pence is 4.3029999 pounds.
const BARCLAYS_SERIES = {
  meta: { symbol: 'BARC', interval: '1day', currency: 'GBp', exchange: 'LSE', mic_code: 'XLON', type: 'Common Stock' },
  values: [{ datetime: '2026-10-09', open: '431.95001', high: '433.95001', low: '427.45001', close: '430.29999', volume: '24409456' }],
  status: 'ok',
}

describe('splitTwelveDataSymbol', () => {
  it('splits at the last colon', () => {
    expect(splitTwelveDataSymbol('BARC:LSE')).toEqual({ symbol: 'BARC', exchange: 'LSE' })
    expect(splitTwelveDataSymbol('BTC/USD:Coinbase Pro')).toEqual({ symbol: 'BTC/USD', exchange: 'Coinbase Pro' })
    expect(splitTwelveDataSymbol('EUR/USD')).toEqual({ symbol: 'EUR/USD' })
  })
})

describe('twelvedata.history', () => {
  it('asks for as-traded daily closes with the key in a header, and sorts them ascending', async () => {
    const { fetch, calls } = fakeFetch([{ match: path('/time_series'), body: AAPL_SERIES }])
    const answer = await twelvedata.history('AAPL:NASDAQ', '2026-10-20', '2026-10-23', ctx(fetch))
    expect(answer).toEqual({
      symbol: 'AAPL:NASDAQ',
      currency: 'USD',
      prices: [
        { date: '2026-10-22', close: 346.5 },
        { date: '2026-10-23', close: 347.73001 },
      ],
    })
    const call = calls[0]!
    expect(call.headers.Authorization).toBe(`apikey ${TEST_KEY}`)
    expect(call.url.toString()).not.toContain(TEST_KEY)
    expect(call.url.searchParams.get('symbol')).toBe('AAPL')
    expect(call.url.searchParams.get('exchange')).toBe('NASDAQ')
    expect(call.url.searchParams.get('adjust')).toBe('none')
    expect(call.url.searchParams.get('interval')).toBe('1day')
  })

  it('turns pence into pounds', async () => {
    const { fetch } = fakeFetch([{ match: path('/time_series'), body: BARCLAYS_SERIES }])
    const answer = await twelvedata.history('BARC:LSE', '2026-10-01', '2026-10-10', ctx(fetch))
    expect(answer).toEqual({ symbol: 'BARC:LSE', currency: 'GBP', prices: [{ date: '2026-10-09', close: 4.3029999 }] })
  })

  it('takes a pair currency from the symbol when the meta has none', async () => {
    const { fetch } = fakeFetch([
      {
        match: path('/time_series'),
        body: { meta: { symbol: 'EUR/USD', currency_base: 'Euro', currency_quote: 'US Dollar' }, values: [{ datetime: '2026-10-23', close: '1.16' }], status: 'ok' },
      },
    ])
    expect((await twelvedata.history('EUR/USD', '2026-10-20', '2026-10-24', ctx(fetch))).currency).toBe('USD')
  })

  it('walks back page by page through a long history', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const d = new Date(Date.UTC(2026, 9, 23) - (start + i) * 86_400_000).toISOString().slice(0, 10)
        return { datetime: d, close: String(100 + start + i) }
      })
    let served = 0
    const { fetch, calls } = fakeFetch([
      {
        match: (url) => url.pathname === '/time_series' && served++ === 0,
        body: { meta: { currency: 'USD' }, values: page(0, 5000), status: 'ok' },
      },
      { match: path('/time_series'), body: { meta: { currency: 'USD' }, values: page(4999, 1000), status: 'ok' } },
    ])
    const answer = await twelvedata.history('AAPL:NASDAQ', '1990-01-01', '2026-10-23', ctx(fetch))
    expect(calls).toHaveLength(2)
    expect(calls[1]!.url.searchParams.get('end_date')).toBe(page(4999, 1)[0]!.datetime)
    expect(answer.prices).toHaveLength(5999)
    expect(answer.prices[answer.prices.length - 1]).toEqual({ date: '2026-10-23', close: 100 })
  })

  it('stops after the pages the protocol can return, so a long history never spends more credits', async () => {
    // Every page is full, as for a symbol with a very long history. `match` runs once per request.
    let served = -1
    const { fetch, calls } = fakeFetch([
      {
        match: (url) => url.pathname === '/time_series' && ++served >= 0,
        get body() {
          const start = 5000 * served
          const values = Array.from({ length: 5000 }, (_, i) => ({
            datetime: new Date(Date.UTC(2026, 9, 23) - (start + i) * 86_400_000).toISOString().slice(0, 10),
            close: '10',
          }))
          return { meta: { currency: 'USD' }, values, status: 'ok' }
        },
      },
    ])
    const answer = await twelvedata.history('AAPL:NASDAQ', '1900-01-01', '2026-10-23', ctx(fetch))
    expect(calls).toHaveLength(4)
    expect(answer.prices).toHaveLength(20_000)
  })

  it('treats "no data is available" as an empty range', async () => {
    const { fetch } = fakeFetch([
      { match: path('/time_series'), body: { code: 400, message: 'No data is available on the specified dates. Try setting different start/end dates.', status: 'error' } },
      { match: path('/symbol_search'), body: { data: [{ symbol: 'AAPL', exchange: 'NASDAQ', currency: 'USD', instrument_name: 'Apple Inc' }], status: 'ok' } },
    ])
    expect(await twelvedata.history('AAPL:NASDAQ', '2026-10-24', '2026-10-25', ctx(fetch))).toEqual({
      symbol: 'AAPL:NASDAQ',
      currency: 'USD',
      prices: [],
    })
  })

  it.each([
    [{ code: 401, message: '**apikey** parameter is incorrect or not specified.', status: 'error' }, 401, 'INVALID_KEY', undefined],
    [{ code: 403, message: 'This symbol is available starting with the Grow plan.', status: 'error' }, 200, 'PLAN_LIMIT', undefined],
    [{ code: 404, message: '**symbol** not found: NOPE.', status: 'error' }, 200, 'NOT_FOUND', undefined],
    [{ code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' }, 429, 'RATE_LIMITED', 60],
    [{ code: 429, message: 'You have run out of API credits for the current day.', status: 'error' }, 429, 'RATE_LIMITED', 12 * 3600],
    [{ code: 500, message: 'Internal error', status: 'error' }, 500, 'PROVIDER_ERROR', undefined],
  ])('maps %o to its code', async (body, status, code, retryAfter) => {
    const { fetch } = fakeFetch([{ match: path('/time_series'), status, body }])
    const err = await twelvedata.history('AAPL:NASDAQ', '2026-10-01', '2026-10-24', ctx(fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectorError)
    expect((err as ConnectorError).code).toBe(code)
    expect((err as ConnectorError).retryAfter).toBe(retryAfter)
  })
})

describe('twelvedata.search', () => {
  it('returns symbols ready for history, in major currencies', async () => {
    const { fetch } = fakeFetch([
      {
        match: path('/symbol_search'),
        body: {
          data: [
            { symbol: 'TSCO', instrument_name: 'Tesco PLC', exchange: 'LSE', mic_code: 'XLON', instrument_type: 'Common Stock', country: 'United Kingdom', currency: 'GBp' },
            { symbol: 'BTC/USD', instrument_name: 'Bitcoin US Dollar', exchange: 'Coinbase Pro', instrument_type: 'Digital Currency' },
          ],
          status: 'ok',
        },
      },
    ])
    expect(await twelvedata.search('tesco', ctx(fetch))).toEqual([
      { symbol: 'TSCO:LSE', name: 'Tesco PLC', exchange: 'LSE', mic: 'XLON', currency: 'GBP', type: 'Common Stock' },
      { symbol: 'BTC/USD:Coinbase Pro', name: 'Bitcoin US Dollar', exchange: 'Coinbase Pro', currency: 'USD', type: 'Digital Currency' },
    ])
  })
})
