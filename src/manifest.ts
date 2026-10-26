import { DEV_PUBLIC_KEY } from './dev-key'
import { allowedOrigins } from './origins'

/** The four provider APIs, and nothing else, the extension may call. */
export const PROVIDER_HOSTS = [
  'https://eodhd.com/*',
  'https://api.twelvedata.com/*',
  'https://www.alphavantage.co/*',
  'https://finnhub.io/*',
] as const

/** `https://app.turbobulls.com` becomes the match pattern `https://app.turbobulls.com/*`. */
function matchPattern(origin: string): string {
  const url = new URL(origin)
  // Chrome match patterns cannot name a port; the background checks the exact origin anyway.
  return `${url.protocol}//${url.hostname}/*`
}

/**
 * The manifest. No content scripts and no page permissions: the extension cannot read any page,
 * the app included. The app reaches it only through `externally_connectable`.
 */
export function buildManifest(mode: string) {
  const development = mode === 'development'
  return {
    name: development ? 'Turbobulls Connector (development)' : 'Turbobulls Connector',
    description: 'Prices from your own market-data provider, with your own API key, for Turbobulls. Your key stays in your browser.',
    permissions: ['storage'],
    host_permissions: [...PROVIDER_HOSTS],
    externally_connectable: { matches: allowedOrigins(mode).map(matchPattern) },
    action: { default_title: 'Turbobulls Connector settings' },
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    minimum_chrome_version: '116',
    ...(development ? { key: DEV_PUBLIC_KEY } : {}),
  }
}
