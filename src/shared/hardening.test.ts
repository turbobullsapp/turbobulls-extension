import { beforeEach, describe, expect, it } from 'vitest'
import { fakeFetch, path, pathStarts, TEST_KEY } from './__fixtures__/fake-fetch.js'
import { dispatch, type DispatchDeps } from './dispatch.js'
import { ConnectorError } from './protocol/errors.js'
import { BoundedCache } from './providers/cache.js'
import { toMajor } from './providers/currency.js'
import { clearEodhdCurrencyCache, eodhd, splitEodhdSymbol } from './providers/eodhd.js'
import { clearFinnhubCurrencyCache, finnhub } from './providers/finnhub.js'
import { clampRetryAfter, getJson, pathSegment, retryAfterSeconds, SMALL_ANSWER_BYTES } from './providers/http.js'
import { createLimiter } from './providers/limiter.js'
import { twelvedata } from './providers/twelvedata.js'
import { cleanText, sanitizeSearchResult } from './sanitize.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')
const ctx = (fetch: ReturnType<typeof fakeFetch>['fetch']) => ({ apiKey: TEST_KEY, fetch, now: NOW })

beforeEach(() => {
  clearEodhdCurrencyCache()
  clearFinnhubCurrencyCache()
})

describe('redirects', () => {
  it('asks fetch to refuse redirects, so a key never follows one to another host', async () => {
    const { fetch, calls } = fakeFetch([
      { match: path('/api/v1/stock/profile2'), status: 302, headers: { Location: 'https://elsewhere.example/steal' } },
    ])
    const err = await finnhub.history('AAPL', '2026-10-20', '2026-10-23', ctx(fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectorError)
    expect((err as ConnectorError).code).toBe('PROVIDER_ERROR')
    expect(calls.every((c) => c.redirect === 'error')).toBe(true)
    expect(calls.every((c) => c.url.hostname === 'finnhub.io')).toBe(true)
  })

  it('treats a 3xx that reaches it as a failure, not as an answer', async () => {
    const lax: ReturnType<typeof fakeFetch>['fetch'] = async () => ({
      status: 301,
      ok: false,
      headers: { get: () => null },
      text: async () => '',
    })
    await expect(getJson({ apiKey: TEST_KEY, fetch: lax }, 'EODHD', 'https://eodhd.com/api/x')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})

describe('answer size', () => {
  it('refuses an answer whose declared length is too large, before reading it', async () => {
    let read = false
    const big: ReturnType<typeof fakeFetch>['fetch'] = async () => ({
      status: 200,
      ok: true,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? String(SMALL_ANSWER_BYTES + 1) : null) },
      text: async () => {
        read = true
        return ''
      },
    })
    await expect(getJson({ apiKey: TEST_KEY, fetch: big }, 'EODHD', 'https://eodhd.com/api/x')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(read).toBe(false)
  })

  it('stops reading a stream as soon as it passes the limit', async () => {
    const chunk = new Uint8Array(256 * 1024).fill(32)
    const { fetch } = fakeFetch([{ match: pathStarts('/api/'), chunks: [chunk, chunk, chunk, chunk, chunk] }])
    await expect(getJson(ctx(fetch), 'EODHD', 'https://eodhd.com/api/x')).rejects.toThrow('too large')
  })

  it('reads a normal stream in full', async () => {
    const text = JSON.stringify([{ date: '2026-10-23', close: 1 }])
    const bytes = new TextEncoder().encode(text)
    const { fetch } = fakeFetch([{ match: pathStarts('/api/'), chunks: [bytes.slice(0, 5), bytes.slice(5)] }])
    expect((await getJson(ctx(fetch), 'EODHD', 'https://eodhd.com/api/x')).body).toEqual([{ date: '2026-10-23', close: 1 }])
  })
})

describe('untrusted provider text', () => {
  it('never turns property names into currencies', () => {
    expect(toMajor('constructor')).toBeUndefined()
    expect(toMajor('__proto__')).toBeUndefined()
    expect(toMajor('toString')).toBeUndefined()
  })

  it('ignores a junk currency in a time series', async () => {
    const { fetch } = fakeFetch([
      { match: path('/time_series'), body: { meta: { currency: 'constructor' }, values: [{ datetime: '2026-10-23', close: '5' }], status: 'ok' } },
    ])
    await expect(twelvedata.history('AAPL:NASDAQ', '2026-10-20', '2026-10-24', ctx(fetch))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('clamps Retry-After to between 1 second and 1 day', () => {
    const h = (v: string) => ({ get: () => v })
    expect(retryAfterSeconds(h('1e21'), 60)).toBe(86_400)
    expect(retryAfterSeconds(h('0'), 60)).toBe(1)
    expect(retryAfterSeconds(h('-5'), 60)).toBe(1)
    expect(clampRetryAfter(Number.NaN)).toBe(86_400)
  })

  it('cleans search results before they reach the app', () => {
    expect(
      sanitizeSearchResult({
        symbol: 'AAPL.US',
        name: `Apple\u0000 Inc\u202e ${'x'.repeat(300)}`,
        exchange: 'US',
        currency: '{}',
        isin: 'not-an-isin',
        type: 'Common Stock',
      }),
    ).toEqual({ symbol: 'AAPL.US', name: `Apple Inc ${'x'.repeat(190)}`, exchange: 'US', type: 'Common Stock' })
    expect(sanitizeSearchResult({ symbol: 'https://evil.example/x', name: 'x' })).toBeUndefined()
    expect(sanitizeSearchResult({ symbol: 'TSCO.LSE', name: '', currency: 'GBP', isin: 'GB00BLGZ9862' })).toEqual({
      symbol: 'TSCO.LSE',
      name: 'TSCO.LSE',
      currency: 'GBP',
      isin: 'GB00BLGZ9862',
    })
    expect(cleanText('\u0007')).toBeUndefined()
  })

  it('drops search results the connector could not price later', async () => {
    const { fetch } = fakeFetch([
      {
        match: pathStarts('/api/search/'),
        body: [
          { Code: 'AAPL', Exchange: 'US', Name: 'Apple', Currency: 'USD' },
          { Code: '//evil', Exchange: 'US', Name: 'x' },
        ],
      },
    ])
    const deps: DispatchDeps = { connector: 'bridge', version: '0.1.0', getKey: () => TEST_KEY, fetch, now: NOW }
    const answer = await dispatch({ v: 1, id: 's', op: 'search', params: { provider: 'eodhd', query: 'apple' } }, deps)
    expect(answer).toEqual({ id: 's', ok: true, result: { results: [{ symbol: 'AAPL.US', name: 'Apple', exchange: 'US', currency: 'USD' }] } })
  })
})

describe('URL paths', () => {
  it('never sends a dot-only path segment', () => {
    expect(() => pathSegment('..')).toThrow(ConnectorError)
    expect(() => pathSegment('.')).toThrow(ConnectorError)
    expect(() => pathSegment('')).toThrow(ConnectorError)
    expect(pathSegment('a/../b')).toBe('a%2F..%2Fb')
    expect(pathSegment('AAPL.US')).toBe('AAPL.US')
  })

  it('refuses EODHD symbols that are not code.exchange', async () => {
    for (const symbol of ['...LSE', '..LSE', '.LSE', 'AAPL.', 'AA PL.US', 'A/B.US', 'AAPL.U-S']) {
      expect(() => splitEodhdSymbol(symbol)).toThrow(ConnectorError)
    }
    const { fetch, calls } = fakeFetch([])
    await expect(eodhd.history('...LSE', '2026-10-01', '2026-10-24', ctx(fetch))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(calls).toHaveLength(0)
  })

  it('only remembers a currency after a history call worked', async () => {
    const { fetch, calls } = fakeFetch([
      { match: pathStarts('/api/search/'), body: [{ Code: 'TSCO', Exchange: 'LSE', Currency: 'GBX' }] },
      { match: pathStarts('/api/eod/'), status: 500, text: 'down' },
    ])
    await expect(eodhd.history('TSCO.LSE', '2026-10-01', '2026-10-24', ctx(fetch))).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    await expect(eodhd.history('TSCO.LSE', '2026-10-01', '2026-10-24', ctx(fetch))).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(calls.filter((c) => c.url.pathname.startsWith('/api/search/'))).toHaveLength(2)
  })
})

describe('bounded state', () => {
  it('forgets the least recently used entry', () => {
    const cache = new BoundedCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.size).toBe(2)
  })

  it('turns calls away once too many are waiting', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const run = createLimiter(0, async () => {}, 2)
    const first = run(() => gate)
    const second = run(async () => 2)
    await expect(run(async () => 3)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 5 })
    release()
    await first
    expect(await second).toBe(2)
    expect(await run(async () => 4)).toBe(4)
  })
})
