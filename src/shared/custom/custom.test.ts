import { describe, expect, it } from 'vitest'
import { fakeFetch, TEST_KEY } from '../__fixtures__/fake-fetch.js'
import { dispatch, type DispatchDeps } from '../dispatch.js'
import { ConnectorError } from '../protocol/errors.js'
import { parseCustomSource, type CustomSource } from './definition.js'
import { buildUrl, customHistory } from './history.js'
import { csvRows, getPath, jsonRows, parseDate, parseNumber, splitCsv } from './parse.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')

function source(over: Record<string, unknown> = {}): CustomSource {
  const result = parseCustomSource({
    id: 'mypension',
    name: 'My pension fund',
    url: 'https://api.example.com/nav/{SYMBOL}?from={FROM}&to={TO}',
    format: 'json',
    json: { items: 'data.prices', date: 'day', close: 'nav' },
    currency: 'EUR',
    ...over,
  })
  if (!result.ok) throw new Error(result.errors.join(' '))
  return result.source
}

describe('parseCustomSource', () => {
  it('accepts a complete JSON source and fills the defaults', () => {
    expect(source()).toEqual({
      id: 'mypension',
      name: 'My pension fund',
      url: 'https://api.example.com/nav/{SYMBOL}?from={FROM}&to={TO}',
      format: 'json',
      json: { items: 'data.prices', date: 'day', close: 'nav' },
      dateFormat: 'YYYY-MM-DD',
      decimal: '.',
      currency: 'EUR',
      headers: {},
    })
  })

  it('accepts a CSV source with column numbers, semicolons and decimal commas', () => {
    const s = source({ format: 'csv', json: undefined, csv: { date: 1, close: '4', delimiter: ';' }, dateFormat: 'DD.MM.YYYY', decimal: ',' })
    expect(s.csv).toEqual({ date: '1', close: '4', delimiter: ';' })
  })

  it.each([
    [{ id: 'eodhd' }, 'taken by a built-in'],
    [{ id: 'My Pension' }, 'lower-case'],
    [{ name: '' }, 'name is required'],
    [{ url: 'http://api.example.com/x' }, 'https://'],
    [{ url: 'https://{SYMBOL}.example.com/x' }, 'plain host'],
    [{ url: 'https://user@api.example.com/x' }, 'plain host'],
    [{ url: 'https://api.example.com/{TICKER}' }, 'unknown placeholder'],
    [{ url: 'https://api.example.com/x}' }, 'brace'],
    [{ url: 'https://api.example.com/a b' }, 'one line'],
    [{ format: 'xml' }, 'json or csv'],
    [{ json: { items: 'data.__proto__', close: 'nav' } }, 'names separated by dots'],
    [{ json: { items: 'data' } }, 'price field is required'],
    [{ currency: 'Euro' }, 'three-letter code'],
    [{ headers: { Cookie: 'a=b' } }, 'header name is not allowed'],
    [{ headers: { 'X-Key': '{SYMBOL}' } }, 'unknown placeholder'],
    [{ dateFormat: 'YYYY/MM/DD' }, 'date format'],
    [{ decimal: ';' }, 'decimal separator'],
  ])('refuses %o', (over, message) => {
    const result = parseCustomSource({ ...source(), ...over })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain(message)
  })

  it('never repeats a value in its errors', () => {
    const result = parseCustomSource({ ...source(), name: '', headers: { Cookie: 'secret-value-123' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).not.toContain('secret-value-123')
  })
})

describe('parsing', () => {
  it('reads dot paths without touching inherited keys', () => {
    const body = { data: { prices: [{ nav: 1 }] }, list: [[1, 2]] }
    expect(getPath(body, 'data.prices.0.nav')).toBe(1)
    expect(getPath(body, 'list.0.1')).toBe(2)
    expect(getPath(body, 'data.toString')).toBeUndefined()
    expect(getPath(body, '')).toBe(body)
  })

  it.each([
    ['2026-10-23', 'YYYY-MM-DD', '2026-10-23'],
    ['2026-10-23T16:00:00Z', 'YYYY-MM-DD', '2026-10-23'],
    ['23/10/2026', 'DD/MM/YYYY', '2026-10-23'],
    ['10/23/2026', 'MM/DD/YYYY', '2026-10-23'],
    ['3.1.2026', 'DD.MM.YYYY', '2026-01-03'],
    ['20261023', 'YYYYMMDD', '2026-10-23'],
    [1792713600, 'unix', '2026-10-23'],
    ['1792713600000', 'unixms', '2026-10-23'],
    ['31/02/2026', 'DD/MM/YYYY', undefined],
    ['Date', 'YYYY-MM-DD', undefined],
  ] as const)('reads %s as %s', (value, format, expected) => {
    expect(parseDate(value, format)).toBe(expected)
  })

  it.each([
    ['1,234.56', '.', 1234.56],
    ['1.234,56', ',', 1234.56],
    ['1 234,56', ',', 1234.56],
    ["1'234.5", '.', 1234.5],
    [12.5, '.', 12.5],
    ['n/a', '.', undefined],
    ['', '.', undefined],
  ] as const)('reads the number %s', (value, decimal, expected) => {
    expect(parseNumber(value, decimal)).toBe(expected)
  })

  it('reads a list, an object keyed by date, and parallel arrays', () => {
    expect(jsonRows([{ date: '2026-10-23', close: '5' }], { items: '', close: 'close' }, 'YYYY-MM-DD', '.')).toEqual([{ date: '2026-10-23', close: 5 }])
    expect(jsonRows({ series: { '2026-10-23': { c: 5 } } }, { items: 'series', close: 'c' }, 'YYYY-MM-DD', '.')).toEqual([{ date: '2026-10-23', close: 5 }])
    expect(
      jsonRows({ chart: { t: [1792713600, 1792800000], c: [5, 6] } }, { items: 'chart', date: 't', close: 'c' }, 'unix', '.'),
    ).toEqual([
      { date: '2026-10-23', close: 5 },
      { date: '2026-10-24', close: 6 },
    ])
  })

  it('splits CSV with quotes, doubled quotes, CRLF and a BOM', () => {
    expect(splitCsv('\uFEFFDate,Name\r\n2026-10-23,"Fund, ""A"""\r\n', ',')).toEqual([
      ['Date', 'Name'],
      ['2026-10-23', 'Fund, "A"'],
    ])
  })

  it('finds CSV columns by name or number and skips rows that do not read', () => {
    const text = 'Datum;Name;Preis\n23.10.2026;Fonds;1.234,50\n24.10.2026;Fonds;n/a\n'
    expect(csvRows(text, { date: 'datum', close: 'PREIS', delimiter: ';' }, 'DD.MM.YYYY', ',')).toEqual([
      { date: undefined, close: undefined },
      { date: '2026-10-23', close: 1234.5 },
      { date: '2026-10-24', close: undefined },
    ])
    expect(csvRows(text, { date: '1', close: '3', delimiter: ';' }, 'DD.MM.YYYY', ',')[1]).toEqual({ date: '2026-10-23', close: 1234.5 })
  })
})

describe('buildUrl', () => {
  it('encodes every value and keeps the host', () => {
    const s = source()
    expect(buildUrl(s, { symbol: 'RO 1/2', from: '2026-10-01', to: '2026-10-26' })).toBe(
      'https://api.example.com/nav/RO%201%2F2?from=2026-10-01&to=2026-10-26',
    )
    expect(buildUrl(s, { symbol: '@evil.example', from: '2026-10-01', to: '2026-10-26' })).toContain('https://api.example.com/nav/%40evil.example')
  })

  it('never lets the symbol climb out of the path', () => {
    expect(() => buildUrl(source(), { symbol: '..', from: '2026-10-01', to: '2026-10-26' })).toThrow(ConnectorError)
  })

  it('fills unix dates and the key', () => {
    const s = source({ url: 'https://api.example.com/q?s={SYMBOL}&a={FROM_UNIX}&b={TO_UNIX}&k={KEY}' })
    const url = new URL(buildUrl(s, { symbol: 'X', from: '2026-10-23', to: '2026-10-23', key: 'a&b' }))
    expect(url.searchParams.get('a')).toBe('1792713600')
    expect(url.searchParams.get('b')).toBe(String(1792713600 + 86_399))
    expect(url.searchParams.get('k')).toBe('a&b')
  })
})

describe('customHistory', () => {
  const NAV = { data: { prices: [{ day: '2026-10-22', nav: '12.5' }, { day: '2026-10-23', nav: 12.75 }, { day: 'later', nav: 1 }] } }

  it('fetches, reads and returns the closes in the configured currency', async () => {
    const { fetch, calls } = fakeFetch([{ match: (u) => u.hostname === 'api.example.com', body: NAV }])
    const answer = await customHistory(source(), 'RO123', '2026-10-01', '2026-10-26', { fetch, now: NOW })
    expect(answer).toEqual({
      symbol: 'RO123',
      currency: 'EUR',
      prices: [
        { date: '2026-10-22', close: 12.5 },
        { date: '2026-10-23', close: 12.75 },
      ],
    })
    expect(calls[0]!.url.pathname).toBe('/nav/RO123')
    expect(calls[0]!.redirect).toBe('follow')
    expect(calls[0]!.credentials).toBe('omit')
  })

  it('sends the key in its header, refuses redirects then, and never puts it in a message', async () => {
    const s = source({ headers: { 'X-Api-Key': '{KEY}' } })
    const { fetch, calls } = fakeFetch([{ match: () => true, status: 401, text: `bad key ${TEST_KEY}` }])
    const err = (await customHistory(s, 'RO123', '2026-10-01', '2026-10-26', { fetch, key: TEST_KEY }).catch((e: unknown) => e)) as ConnectorError
    expect(calls[0]!.headers['X-Api-Key']).toBe(TEST_KEY)
    expect(calls[0]!.redirect).toBe('error')
    expect(err.code).toBe('INVALID_KEY')
    expect(err.message).not.toContain(TEST_KEY)
  })

  it('asks for the key when the source needs one and none is set', async () => {
    const s = source({ url: 'https://api.example.com/nav/{SYMBOL}?apikey={KEY}' })
    await expect(customHistory(s, 'RO123', '2026-10-01', '2026-10-26', { fetch: fakeFetch([]).fetch })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
  })

  it('reads a CSV source and turns pence into pounds', async () => {
    const s = source({ format: 'csv', json: undefined, csv: { date: 'Date', close: 'Close' }, currency: 'GBp', url: 'https://example.org/prices.csv' })
    const { fetch } = fakeFetch([{ match: () => true, text: 'Date,Close\n2026-10-23,357.40\n' }])
    expect(await customHistory(s, 'TSCO', '2026-10-01', '2026-10-26', { fetch })).toEqual({
      symbol: 'TSCO',
      currency: 'GBP',
      prices: [{ date: '2026-10-23', close: 3.574 }],
    })
  })

  it('says plainly when the paths point at nothing', async () => {
    const { fetch } = fakeFetch([{ match: () => true, body: { other: [] } }])
    await expect(customHistory(source(), 'RO123', '2026-10-01', '2026-10-26', { fetch })).rejects.toThrow('Check the paths')
    const { fetch: notJson } = fakeFetch([{ match: () => true, text: '<html>' }])
    await expect(customHistory(source(), 'RO123', '2026-10-01', '2026-10-26', { fetch: notJson })).rejects.toThrow('did not answer with JSON')
  })

  it.each([
    [403, 'PLAN_LIMIT'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_ERROR'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const { fetch } = fakeFetch([{ match: () => true, status, text: 'x' }])
    await expect(customHistory(source(), 'RO123', '2026-10-01', '2026-10-26', { fetch })).rejects.toMatchObject({ code })
  })
})

describe('dispatch with custom sources', () => {
  const NAV = { data: { prices: [{ day: '2026-10-23', nav: 12.75 }] } }

  function deps(over: Partial<DispatchDeps> = {}): DispatchDeps {
    return {
      connector: 'extension',
      version: '0.1.0',
      getKey: () => undefined,
      fetch: fakeFetch([{ match: () => true, body: NAV }]).fetch,
      customSources: () => [source({ symbolHint: 'Fund code' })],
      now: NOW,
      ...over,
    }
  }

  it('lists custom sources after the built-ins in hello', async () => {
    const answer = await dispatch({ v: 1, id: 'h', op: 'hello' }, deps())
    expect(answer.ok && (answer.result as { providers: unknown[] }).providers[4]).toEqual({
      id: 'mypension',
      name: 'My pension fund',
      configured: true,
      custom: true,
      symbolHint: 'Fund code',
      capabilities: { search: false, history: true },
    })
  })

  it('lists at most 12 custom sources', async () => {
    const many = Array.from({ length: 15 }, (_, i) => source({ id: `src${i}` }))
    const answer = await dispatch({ v: 1, id: 'h', op: 'hello' }, deps({ customSources: () => many }))
    expect(answer.ok && (answer.result as { providers: unknown[] }).providers).toHaveLength(16)
  })

  it('answers history from a custom source and refuses search on it', async () => {
    expect(
      await dispatch({ v: 1, id: 'q', op: 'history', params: { provider: 'mypension', symbol: 'RO123', from: '2026-10-01' } }, deps()),
    ).toEqual({ id: 'q', ok: true, result: { symbol: 'RO123', currency: 'EUR', prices: [{ date: '2026-10-23', close: 12.75 }] } })
    expect(await dispatch({ v: 1, id: 's', op: 'search', params: { provider: 'mypension', query: 'x' } }, deps())).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_OPERATION' },
    })
  })

  it('says a source it does not have is not configured', async () => {
    for (const op of ['search', 'history'] as const) {
      const params = op === 'search' ? { provider: 'nosuch', query: 'x' } : { provider: 'nosuch', symbol: 'X', from: '2026-10-01' }
      expect(await dispatch({ v: 1, id: 'x', op, params }, deps())).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } })
    }
  })

  it('asks the connector whether it may reach the source before fetching', async () => {
    const { fetch, calls } = fakeFetch([{ match: () => true, body: NAV }])
    const seen: string[] = []
    const answer = await dispatch(
      { v: 1, id: 'q', op: 'history', params: { provider: 'mypension', symbol: 'RO123', from: '2026-10-01' } },
      deps({ fetch, canReach: (origin) => (seen.push(origin), false) }),
    )
    expect(answer).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } })
    expect(seen).toEqual(['https://api.example.com'])
    expect(calls).toHaveLength(0)
  })
})
