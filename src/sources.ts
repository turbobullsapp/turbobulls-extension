import { browser } from 'wxt/browser'
import { setKey } from './keys'
import { parseCustomSource, templateHost, type CustomSource } from './shared/custom/definition.js'
import { CUSTOM_ID_RE, LIMITS, PROVIDER_IDS } from './shared/protocol/types.js'

/**
 * Custom sources the user defined on the settings page, in `storage.local` (this device only).
 * Each is checked again whenever it is read, so a damaged entry is skipped, never used.
 */
const STORAGE_KEY = 'sources'

export async function getCustomSources(): Promise<CustomSource[]> {
  const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
  if (!Array.isArray(stored)) return []
  const sources: CustomSource[] = []
  for (const raw of stored) {
    const result = parseCustomSource(raw)
    if (result.ok && !sources.some((s) => s.id === result.source.id)) sources.push(result.source)
  }
  return sources.slice(0, LIMITS.customSources)
}

/** Add a source, or replace the one with the same id. */
export async function saveCustomSource(source: CustomSource): Promise<void> {
  const sources = await getCustomSources()
  const index = sources.findIndex((s) => s.id === source.id)
  if (index >= 0) sources[index] = source
  else if (sources.length >= LIMITS.customSources) throw new Error(`At most ${LIMITS.customSources} custom sources.`)
  else sources.push(source)
  await browser.storage.local.set({ [STORAGE_KEY]: sources })
}

/** Remove a source and its key, and give back the site permission no other source still needs. */
export async function removeCustomSource(id: string): Promise<void> {
  const sources = await getCustomSources()
  const removed = sources.find((s) => s.id === id)
  const remaining = sources.filter((s) => s.id !== id)
  await browser.storage.local.set({ [STORAGE_KEY]: remaining })
  await setKey(id, '')
  if (removed && !remaining.some((s) => hostOf(s) === hostOf(removed))) {
    await browser.permissions.remove({ origins: [sitePattern(removed)] }).catch(() => false)
  }
}

/** The host name a source talks to, without a port. */
export function hostOf(source: Pick<CustomSource, 'url'>): string {
  return (templateHost(source.url) ?? '').replace(/:\d+$/, '').toLowerCase()
}

/** The permission pattern for a source's site: `https://host/*` (a pattern covers every port). */
export function sitePattern(source: Pick<CustomSource, 'url'>): string {
  return `https://${hostOf(source)}/*`
}

/** Whether the user has let the extension reach this origin (`https://host[:port]`). */
export async function canReach(origin: string): Promise<boolean> {
  const host = origin.replace(/^https:\/\//, '').replace(/:\d+$/, '').toLowerCase()
  if (!host) return false
  return browser.permissions.contains({ origins: [`https://${host}/*`] })
}

/** An id for a new source, from its name: lower-case letters and digits, unique, never a built-in id. */
export function newSourceId(name: string, taken: readonly string[]): string {
  let base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 28)
  if (!/^[a-z]/.test(base)) base = `src${base}`.slice(0, 28)
  if (base.length < 2) base = 'source'
  const used = new Set([...taken, ...PROVIDER_IDS])
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}${n}`
  return CUSTOM_ID_RE.test(id) ? id : 'source'
}
