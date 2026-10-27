import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { getKey, setKey } from './keys'
import { parseCustomSource, type CustomSource } from './shared/custom/definition.js'
import { canReach, getCustomSources, hostOf, keyDecision, newSourceId, reconcileSitePermissions, removeCustomSource, saveCustomSource, sitePattern } from './sources'

function source(id: string, url = 'https://api.example.com/nav/{SYMBOL}'): CustomSource {
  const result = parseCustomSource({ id, name: `Source ${id}`, url, format: 'json', json: { items: '', close: 'close' }, currency: 'EUR' })
  if (!result.ok) throw new Error(result.errors.join(' '))
  return result.source
}

beforeEach(() => {
  fakeBrowser.reset()
})

describe('custom sources in extension storage', () => {
  it('saves, replaces and lists sources', async () => {
    expect(await getCustomSources()).toEqual([])
    await saveCustomSource(source('one'))
    await saveCustomSource(source('two'))
    await saveCustomSource({ ...source('one'), name: 'Renamed' })
    expect((await getCustomSources()).map((s) => [s.id, s.name])).toEqual([
      ['one', 'Renamed'],
      ['two', 'Source two'],
    ])
  })

  it('skips damaged entries when reading', async () => {
    await fakeBrowser.storage.local.set({ sources: [source('good'), { id: 'bad', url: 'http://x' }, 'junk', source('good')] })
    expect((await getCustomSources()).map((s) => s.id)).toEqual(['good'])
  })

  it('stops at 12 sources', async () => {
    for (let i = 0; i < 12; i++) await saveCustomSource(source(`src${i}`))
    await expect(saveCustomSource(source('another'))).rejects.toThrow('At most 12')
  })

  it('removes a source with its key, and gives back a site no other source uses', async () => {
    const granted = new Set(['https://eodhd.com/*', 'https://api.example.com/*', 'https://data.example.org/*'])
    vi.spyOn(fakeBrowser.permissions, 'getAll').mockImplementation((async () => ({ origins: [...granted], permissions: [] })) as never)
    const remove = vi.spyOn(fakeBrowser.permissions, 'remove').mockImplementation((async ({ origins }: { origins: string[] }) => {
      for (const o of origins) granted.delete(o)
      return true
    }) as never)
    await saveCustomSource(source('one'))
    await saveCustomSource(source('two'))
    await saveCustomSource(source('other', 'https://data.example.org/{SYMBOL}.csv'))
    await setKey('one', 'secret-1')
    await removeCustomSource('one')
    expect(await getKey('one')).toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
    await removeCustomSource('two')
    expect(remove).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] })
    expect((await getCustomSources()).map((s) => s.id)).toEqual(['other'])
    expect([...granted]).toEqual(['https://eodhd.com/*', 'https://data.example.org/*'])
  })

  it('gives back sites granted for a Try that was never saved, and never a provider API', async () => {
    vi.spyOn(fakeBrowser.permissions, 'getAll').mockImplementation(
      (async () => ({ origins: ['https://finnhub.io/*', 'https://tried.example.com/*', 'https://api.example.com/*'], permissions: [] })) as never,
    )
    const remove = vi.spyOn(fakeBrowser.permissions, 'remove').mockResolvedValue(true as never)
    await saveCustomSource(source('kept'))
    await reconcileSitePermissions()
    expect(remove).toHaveBeenCalledWith({ origins: ['https://tried.example.com/*'] })
  })

  it('keeps custom source keys apart from provider keys', async () => {
    await setKey('mysource', 'custom-secret')
    await setKey('eodhd', 'provider-secret')
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ 'customkey:mysource': 'custom-secret', 'key:eodhd': 'provider-secret' })
    expect(await getKey('mysource')).toBe('custom-secret')
  })

  it('makes a saved key stay with its site', () => {
    const keyed = (url: string) => {
      const r = parseCustomSource({ id: 'kk', name: 'K', url, format: 'json', json: { items: '', close: 'close' }, currency: 'EUR', headers: { 'X-Api-Key': '{KEY}' } })
      if (!r.ok) throw new Error(r.errors.join(' '))
      return r.source
    }
    const before = keyed('https://a.example.com/{SYMBOL}')
    expect(keyDecision(before, keyed('https://a.example.com/v2/{SYMBOL}'), '')).toBe('saved')
    expect(keyDecision(before, keyed('https://b.example.com/{SYMBOL}'), '')).toBe('retype')
    expect(keyDecision(before, keyed('https://b.example.com/{SYMBOL}'), 'new-key')).toBe('typed')
    expect(keyDecision(undefined, keyed('https://b.example.com/{SYMBOL}'), '')).toBe('missing')
    expect(keyDecision(undefined, source('nokey'), '')).toBe('none')
  })

  it('asks the browser whether it may reach a site, by host and without the port', async () => {
    const contains = vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(false as never)
    expect(await canReach('https://api.example.com:8443')).toBe(false)
    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] })
    expect(await canReach('https://')).toBe(false)
  })

  it('builds site patterns and ids', () => {
    expect(hostOf(source('xx', 'https://API.example.com:8443/{SYMBOL}'))).toBe('api.example.com')
    expect(sitePattern(source('xx', 'https://api.example.com:8443/{SYMBOL}'))).toBe('https://api.example.com/*')
    expect(newSourceId('My Pension Fund!', [])).toBe('mypensionfund')
    expect(newSourceId('My Pension Fund', ['mypensionfund'])).toBe('mypensionfund2')
    expect(newSourceId('EODHD', [])).toBe('eodhd2')
    expect(newSourceId('123 Fund', [])).toBe('src123fund')
    expect(newSourceId('!', [])).toBe('src')
  })
})
