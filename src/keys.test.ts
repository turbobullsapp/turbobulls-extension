import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { getKey, keyHints, setKey } from './keys'

beforeEach(() => {
  fakeBrowser.reset()
})

describe('keys', () => {
  it('saves, trims, reads and removes a key in local storage only', async () => {
    await setKey('eodhd', '  abc123xyz  ')
    expect(await getKey('eodhd')).toBe('abc123xyz')
    expect(await fakeBrowser.storage.local.get('key:eodhd')).toEqual({ 'key:eodhd': 'abc123xyz' })
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({})

    await setKey('eodhd', '   ')
    expect(await getKey('eodhd')).toBeUndefined()
    expect(await fakeBrowser.storage.local.get(null)).toEqual({})
  })

  it('says which keys are set by their last four characters only', async () => {
    await setKey('finnhub', 'secret-1234')
    expect(await keyHints()).toEqual({ finnhub: '1234' })
  })
})
