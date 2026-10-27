import { browser } from 'wxt/browser'

/**
 * When the extension last sent prices to Turbobulls: a single timestamp, nothing about which
 * symbols, so the settings page can tell the user their setup works.
 */
const STORAGE_KEY = 'lastPricesAt'

export async function markPricesSent(now: Date = new Date()): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: now.toISOString() })
}

export async function lastPricesSent(): Promise<Date | undefined> {
  const value = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
