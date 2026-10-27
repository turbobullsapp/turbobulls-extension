import { browser } from 'wxt/browser'
import { PROVIDER_IDS, type ProviderId, type SourceId } from './shared/protocol/types.js'

/**
 * Keys live in `storage.local`: on this device only, never synced to a browser account, and only
 * readable by this extension. A custom source's key sits under its id, like a provider's.
 */
const PREFIX = 'key:'

export async function getKey(source: SourceId): Promise<string | undefined> {
  const name = PREFIX + source
  const stored = await browser.storage.local.get(name)
  const value = stored[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Save a key; an empty value removes it. */
export async function setKey(source: SourceId, value: string): Promise<void> {
  const name = PREFIX + source
  const trimmed = value.trim()
  if (trimmed) await browser.storage.local.set({ [name]: trimmed })
  else await browser.storage.local.remove(name)
}

/** The last four characters of each saved provider key, so the settings page can say which key is set. */
export async function keyHints(): Promise<Partial<Record<ProviderId, string>>> {
  const hints: Partial<Record<ProviderId, string>> = {}
  for (const provider of PROVIDER_IDS) {
    const key = await getKey(provider)
    if (key) hints[provider] = key.slice(-4)
  }
  return hints
}
