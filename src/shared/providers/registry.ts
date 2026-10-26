import { PROVIDER_IDS, type ProviderId, type ProviderInfo } from '../protocol/types.js'
import { alphavantage } from './alphavantage.js'
import { eodhd } from './eodhd.js'
import { finnhub } from './finnhub.js'
import { twelvedata } from './twelvedata.js'
import type { ProviderAdapter } from './types.js'

export const ADAPTERS: Readonly<Record<ProviderId, ProviderAdapter>> = { eodhd, twelvedata, alphavantage, finnhub }

/** Pause between two calls to the same provider, so a burst never trips a per-second limit. */
export const MIN_GAP_MS: Readonly<Record<ProviderId, number>> = {
  eodhd: 100,
  twelvedata: 250,
  alphavantage: 1000,
  finnhub: 250,
}

export function providerInfo(id: ProviderId, configured: boolean): ProviderInfo {
  const adapter = ADAPTERS[id]
  return { id, name: adapter.name, configured, capabilities: { ...adapter.capabilities } }
}

export function allProviderIds(): readonly ProviderId[] {
  return PROVIDER_IDS
}
