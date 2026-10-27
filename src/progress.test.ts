import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { setupPill, stepStates } from './entrypoints/options/steps'
import { createExternalHandler } from './external'
import { lastPricesSent, markPricesSent } from './progress'
import { fakeFetch, path, TEST_KEY } from './shared/__fixtures__/fake-fetch.js'

beforeEach(() => {
  fakeBrowser.reset()
})

describe('setup steps', () => {
  it('points at the first step not done yet', () => {
    expect(stepStates({ ready: [], lastSent: undefined })).toEqual(['current', 'upcoming', 'upcoming'])
    expect(stepStates({ ready: ['EODHD'], lastSent: undefined })).toEqual(['done', 'current', 'upcoming'])
    expect(stepStates({ ready: ['EODHD'], lastSent: new Date() })).toEqual(['done', 'done', 'done'])
  })

  it('says by the title whether nothing is set up, a source is ready, or prices have gone out', () => {
    expect(setupPill({ ready: [], lastSent: undefined })).toEqual({ label: 'Not set up yet', tone: 'none' })
    expect(setupPill({ ready: ['EODHD'], lastSent: undefined })).toEqual({ label: 'Ready to link', tone: 'next' })
    expect(setupPill({ ready: ['EODHD'], lastSent: new Date() })).toEqual({ label: 'Working', tone: 'ok' })
    // Prices went out once, but every key and source has since been removed: nothing works now.
    expect(setupPill({ ready: [], lastSent: new Date() })).toEqual({ label: 'Not set up yet', tone: 'none' })
  })
})

describe('prices sent', () => {
  it('remembers only when prices last went to the app', async () => {
    expect(await lastPricesSent()).toBeUndefined()
    await markPricesSent(new Date('2026-10-27T10:00:00Z'))
    expect((await lastPricesSent())?.toISOString()).toBe('2026-10-27T10:00:00.000Z')
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['lastPricesAt'])
  })

  it('is marked after a history answer to the app, not after a hello or a refusal', async () => {
    const sent: string[] = []
    const { fetch } = fakeFetch([{ match: path('/api/eod/AAPL.US'), body: [{ date: '2026-10-23', close: 1 }] }])
    const handle = createExternalHandler({
      allowedOrigins: ['https://app.turbobulls.com'],
      deps: { connector: 'extension', version: '0.1.0', getKey: () => TEST_KEY, fetch, now: () => new Date('2026-10-26T12:00:00Z') },
      onPricesSent: () => void sent.push('history'),
    })
    const app = { origin: 'https://app.turbobulls.com', frameId: 0 }
    await handle({ v: 1, id: 'h', op: 'hello' }, app)
    await handle({ v: 1, id: 'q', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-10-20' } }, { origin: 'https://evil.example', frameId: 0 })
    expect(sent).toEqual([])
    await handle({ v: 1, id: 'q', op: 'history', params: { provider: 'eodhd', symbol: 'AAPL.US', from: '2026-10-20' } }, app)
    expect(sent).toEqual(['history'])
  })
})
