import { describe, expect, it } from 'vitest'
import { fakeFetch, path, TEST_KEY, type FakeRoute } from './__fixtures__/fake-fetch.js'
import { dispatch, type DispatchDeps } from './dispatch.js'
import { createRefusalMemory, keyFingerprint } from './refusals.js'

const START = Date.parse('2026-10-26T12:00:00Z')
const SECOND = 1000
const MINUTE = 60 * SECOND

/** A connector with a refusal memory and a clock the test moves by hand. */
function connector(routes: FakeRoute[]) {
  const { fetch, calls } = fakeFetch(routes)
  const state = { now: START, key: TEST_KEY }
  const deps: DispatchDeps = {
    connector: 'bridge',
    version: '0.1.0',
    getKey: () => state.key,
    fetch,
    now: () => new Date(state.now),
    refusals: createRefusalMemory(),
  }
  const history = (symbol = 'AAPL.US') =>
    dispatch({ v: 1, id: 'h', op: 'history', params: { provider: 'eodhd', symbol, from: '2026-10-20', to: '2026-10-23' } }, deps)
  const search = () => dispatch({ v: 1, id: 's', op: 'search', params: { provider: 'eodhd', query: 'apple' } }, deps)
  return { calls, state, deps, history, search }
}

const PRICES = [{ date: '2026-10-23', close: 347.73 }]

describe('refusal memory', () => {
  it('answers a rate limit itself until the retry time, then asks the provider again', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 429, headers: { 'Retry-After': '30' } }])
    expect(await c.history()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryAfter: 30 } })
    c.state.now += 10 * SECOND
    expect(await c.history()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryAfter: 20 } })
    // The limit is the provider's, so a search waits too.
    expect(await c.search()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
    expect(c.calls).toHaveLength(1)
    c.state.now += 21 * SECOND
    await c.history()
    expect(c.calls).toHaveLength(2)
  })

  it('keeps a daily limit for an hour at most, while still reporting when the provider resets', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 402 }])
    expect(await c.history()).toMatchObject({ error: { code: 'RATE_LIMITED', retryAfter: 12 * 3600 } })
    c.state.now += 30 * MINUTE
    expect(await c.history()).toMatchObject({ error: { code: 'RATE_LIMITED', retryAfter: 12 * 3600 - 30 * 60 } })
    expect(c.calls).toHaveLength(1)
    c.state.now += 31 * MINUTE
    await c.history()
    expect(c.calls).toHaveLength(2)
  })

  it('stops sending a refused key, and sends a new one at once', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 401, text: `bad token ${TEST_KEY}` }])
    expect(await c.history()).toMatchObject({ error: { code: 'INVALID_KEY' } })
    const again = await c.history()
    expect(again).toMatchObject({ error: { code: 'INVALID_KEY' } })
    expect(JSON.stringify(again)).not.toContain(TEST_KEY)
    expect(c.calls).toHaveLength(1)
    c.state.key = 'another-fake-key-for-tests'
    await c.history()
    expect(c.calls).toHaveLength(2)
  })

  it('asks about a refused key again after five minutes, in case the provider was wrong', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 401 }])
    await c.history()
    c.state.now += 4 * MINUTE
    await c.history()
    expect(c.calls).toHaveLength(1)
    c.state.now += 2 * MINUTE
    await c.history()
    expect(c.calls).toHaveLength(2)
  })

  it('holds back only the symbol the plan does not cover', async () => {
    const c = connector([
      { match: path('/api/eod/AAPL.US'), status: 403 },
      { match: path('/api/eod/MSFT.US'), body: PRICES },
    ])
    expect(await c.history('AAPL.US')).toMatchObject({ error: { code: 'PLAN_LIMIT' } })
    expect(await c.history('AAPL.US')).toMatchObject({ error: { code: 'PLAN_LIMIT' } })
    expect(await c.history('MSFT.US')).toMatchObject({ ok: true })
    expect(c.calls.map((call) => call.url.pathname)).toEqual(['/api/eod/AAPL.US', '/api/eod/MSFT.US'])
  })

  it('stops calls already waiting their turn once one of them is refused', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 429, headers: { 'Retry-After': '60' } }])
    const answers = await Promise.all([c.history(), c.history(), c.history()])
    expect(answers.every((a) => !a.ok && a.error.code === 'RATE_LIMITED')).toBe(true)
    expect(c.calls).toHaveLength(1)
  })

  it('remembers nothing that asking again could fix', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 500 }])
    await c.history()
    await c.history()
    expect(c.calls).toHaveLength(2)
  })

  it('asks every time when the connector keeps no memory, as a settings page testing a key does', async () => {
    const c = connector([{ match: path('/api/eod/AAPL.US'), status: 401 }])
    delete c.deps.refusals
    await c.history()
    await c.history()
    expect(c.calls).toHaveLength(2)
  })
})

describe('keyFingerprint', () => {
  it('tells keys apart without holding them', () => {
    expect(keyFingerprint(TEST_KEY)).toBe(keyFingerprint(TEST_KEY))
    expect(keyFingerprint(TEST_KEY)).not.toBe(keyFingerprint(`${TEST_KEY}x`))
    expect(keyFingerprint(undefined)).toBe(keyFingerprint(''))
    expect(keyFingerprint(TEST_KEY)).toMatch(/^[0-9a-f]{1,8}$/)
  })
})
