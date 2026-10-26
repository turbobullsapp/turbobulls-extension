import { describe, expect, it } from 'vitest'
import { createExternalHandler, senderOrigin } from './external'
import { allowedOrigins, APP_ORIGIN, DEV_ORIGIN } from './origins'
import { fakeFetch, path, TEST_KEY } from './shared/__fixtures__/fake-fetch.js'
import type { DispatchDeps } from './shared/dispatch.js'

function handler(mode: string, over: Partial<DispatchDeps> = {}) {
  return createExternalHandler({
    allowedOrigins: allowedOrigins(mode),
    deps: {
      connector: 'extension',
      version: '0.1.0',
      getKey: (id) => (id === 'eodhd' ? TEST_KEY : undefined),
      fetch: fakeFetch([]).fetch,
      now: () => new Date('2026-10-26T12:00:00Z'),
      ...over,
    },
  })
}

const HELLO = { v: 1, id: 'h', op: 'hello' }

describe('senderOrigin', () => {
  it('reads sender.origin only, never the URL', () => {
    expect(senderOrigin({ origin: APP_ORIGIN, url: 'https://evil.example/' })).toBe(APP_ORIGIN)
    expect(senderOrigin({ url: 'https://app.turbobulls.com/project/1/assets' })).toBeUndefined()
    // A sandboxed frame or page on the app's URL reports origin "null".
    expect(senderOrigin({ origin: 'null', url: 'https://app.turbobulls.com/upload/preview' })).toBeUndefined()
    expect(senderOrigin({})).toBeUndefined()
  })
})

describe('external messages', () => {
  it('answers the Turbobulls app', async () => {
    const answer = await handler('production')(HELLO, { origin: APP_ORIGIN, frameId: 0 })
    expect(answer).toMatchObject({ id: 'h', ok: true, result: { protocol: 1, connector: 'extension', version: '0.1.0' } })
    expect(JSON.stringify(answer)).not.toContain(TEST_KEY)
  })

  it('refuses every other sender', async () => {
    const handle = handler('production')
    for (const sender of [
      { origin: 'https://evil.example', frameId: 0 },
      { origin: 'https://app.turbobulls.com.evil.example', frameId: 0 },
      { origin: DEV_ORIGIN, frameId: 0 },
      { id: 'abcdefghijklmnopabcdefghijklmnop', origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
      { origin: 'null', url: 'https://app.turbobulls.com/', frameId: 0 },
      { url: 'https://app.turbobulls.com/', frameId: 0 },
      // The app's own origin, but from a frame inside a page rather than the page itself.
      { origin: APP_ORIGIN, frameId: 3 },
      { origin: APP_ORIGIN },
      {},
    ]) {
      expect(await handle(HELLO, sender)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    }
  })

  it('answers the dev server only in a development build, and only on its port', async () => {
    expect(await handler('development')(HELLO, { origin: DEV_ORIGIN, frameId: 0 })).toMatchObject({ ok: true })
    expect(await handler('development')(HELLO, { origin: 'http://localhost:4000', frameId: 0 })).toMatchObject({ ok: false })
    expect(await handler('production')(HELLO, { origin: DEV_ORIGIN, frameId: 0 })).toMatchObject({ ok: false })
  })

  it('fetches prices for the app and passes back only the prices', async () => {
    const { fetch, calls } = fakeFetch([{ match: path('/api/eod/AAPL.US'), body: [{ date: '2026-10-23', close: 347.73, volume: 1 }] }])
    const answer = await handler('production', { fetch })(
      { v: 1, id: 'q', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-10-20' } },
      { origin: APP_ORIGIN, frameId: 0 },
    )
    expect(answer).toEqual({ id: 'q', ok: true, result: { symbol: 'AAPL.US', currency: 'USD', prices: [{ date: '2026-10-23', close: 347.73 }] } })
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TEST_KEY}`)
  })

  it('opens its settings page when the app asks', async () => {
    let opened = 0
    const answer = await handler('production', { openSettings: () => void opened++ })({ v: 1, id: 'o', op: 'openSettings' }, { origin: APP_ORIGIN, frameId: 0 })
    expect(answer).toEqual({ id: 'o', ok: true, result: { opened: true } })
    expect(opened).toBe(1)
  })
})
