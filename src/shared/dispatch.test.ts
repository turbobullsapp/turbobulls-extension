import { beforeEach, describe, expect, it } from 'vitest'
import { fakeFetch, path, pathStarts, TEST_KEY } from './__fixtures__/fake-fetch.js'
import { dispatch, type DispatchDeps } from './dispatch.js'
import type { ProviderId } from './protocol/types.js'
import { clearEodhdCurrencyCache } from './providers/eodhd.js'

const NOW = () => new Date('2026-10-26T12:00:00Z')

function deps(over: Partial<DispatchDeps> = {}, keys: Partial<Record<ProviderId, string>> = { eodhd: TEST_KEY }): DispatchDeps {
  return {
    connector: 'bridge',
    version: '0.1.0',
    getKey: (id) => keys[id],
    fetch: fakeFetch([]).fetch,
    now: NOW,
    ...over,
  }
}

beforeEach(() => clearEodhdCurrencyCache())

describe('dispatch', () => {
  it('says hello with every provider and whether a key is set', async () => {
    const answer = await dispatch({ v: 1, id: 'h1', op: 'hello' }, deps({}, { eodhd: TEST_KEY, finnhub: '  ' }))
    expect(answer).toEqual({
      id: 'h1',
      ok: true,
      result: {
        protocol: 1,
        connector: 'bridge',
        version: '0.1.0',
        providers: [
          { id: 'eodhd', name: 'EODHD', configured: true, capabilities: { search: true, history: true } },
          { id: 'twelvedata', name: 'Twelve Data', configured: false, capabilities: { search: true, history: true } },
          { id: 'alphavantage', name: 'Alpha Vantage', configured: false, capabilities: { search: true, history: true } },
          { id: 'finnhub', name: 'Finnhub', configured: false, capabilities: { search: true, history: true } },
        ],
      },
    })
  })

  it('never returns a key in a hello', async () => {
    const answer = await dispatch({ v: 1, id: 'h1', op: 'hello' }, deps())
    expect(JSON.stringify(answer)).not.toContain(TEST_KEY)
  })

  it('answers a history request, defaulting "to" to today', async () => {
    const { fetch, calls } = fakeFetch([{ match: path('/api/eod/AAPL.US'), body: [{ date: '2026-10-23', close: 347.73 }] }])
    const answer = await dispatch(
      { v: 1, id: 'q1', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-10-20' } },
      deps({ fetch }),
    )
    expect(answer).toEqual({ id: 'q1', ok: true, result: { symbol: 'AAPL.US', currency: 'USD', prices: [{ date: '2026-10-23', close: 347.73 }] } })
    expect(calls[0]!.url.searchParams.get('to')).toBe('2026-10-26')
  })

  it('says NOT_CONFIGURED when the provider has no key', async () => {
    const answer = await dispatch({ v: 1, id: 's', op: 'search', params: { provider: 'twelvedata', query: 'aapl' } }, deps())
    expect(answer).toEqual({ id: 's', ok: false, error: { code: 'NOT_CONFIGURED', message: 'No Twelve Data API key is set in this connector.' } })
  })

  it('turns bad requests into errors with the request id kept', async () => {
    expect(await dispatch({ v: 1, id: 'z', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: 'yesterday' } }, deps())).toMatchObject({
      id: 'z',
      ok: false,
      error: { code: 'BAD_REQUEST' },
    })
    expect(await dispatch({ v: 9, id: 'z', op: 'hello' }, deps())).toMatchObject({ id: 'z', ok: false, error: { code: 'UNSUPPORTED_PROTOCOL' } })
  })

  it('opens settings only where the connector has them', async () => {
    let opened = 0
    expect(await dispatch({ v: 1, id: 'o', op: 'openSettings' }, deps({ openSettings: () => void opened++ }))).toEqual({
      id: 'o',
      ok: true,
      result: { opened: true },
    })
    expect(opened).toBe(1)
    expect(await dispatch({ v: 1, id: 'o', op: 'openSettings' }, deps())).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } })
  })

  it('hides the details of an unexpected failure', async () => {
    const fetch: DispatchDeps['fetch'] = async () => {
      throw new TypeError(`socket hang up while sending ${TEST_KEY}`)
    }
    const answer = await dispatch({ v: 1, id: 'x', op: 'search', params: { provider: 'eodhd', query: 'aapl' } }, deps({ fetch }))
    expect(answer).toMatchObject({ ok: false, error: { code: 'PROVIDER_ERROR' } })
    expect(JSON.stringify(answer)).not.toContain(TEST_KEY)
  })

  it('never lets a provider message carry the key back', async () => {
    const { fetch } = fakeFetch([{ match: pathStarts('/api/eod/'), status: 401, text: `bad token ${TEST_KEY}` }])
    const answer = await dispatch({ v: 1, id: 'x', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-10-01' } }, deps({ fetch }))
    expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_KEY' } })
    expect(JSON.stringify(answer)).not.toContain(TEST_KEY)
  })
})
