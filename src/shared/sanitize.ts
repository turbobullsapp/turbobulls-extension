import type { SearchResult } from './protocol/types.js'
import { isValidSymbol } from './protocol/validate.js'

/** Longest text a search result field may carry to the app. */
export const TEXT_MAX = 200

// Control characters and the bidirectional overrides that can make text display out of order.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g
const ISO_CURRENCY = /^[A-Z]{3}$/
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

export function cleanText(value: string | undefined, max: number = TEXT_MAX): string | undefined {
  if (value === undefined) return undefined
  const cleaned = value.replace(UNSAFE_CHARS, '').trim().slice(0, max).trim()
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Provider text is untrusted. A result reaches the app only with a symbol the connector would
 * accept back in a history request, short plain-text fields, a real currency code and a well-formed
 * ISIN; anything else is dropped.
 */
export function sanitizeSearchResult(result: SearchResult): SearchResult | undefined {
  if (!isValidSymbol(result.symbol)) return undefined
  const out: SearchResult = { symbol: result.symbol, name: cleanText(result.name) ?? result.symbol }
  const exchange = cleanText(result.exchange, 64)
  if (exchange) out.exchange = exchange
  const mic = cleanText(result.mic, 16)
  if (mic) out.mic = mic
  if (result.currency && ISO_CURRENCY.test(result.currency)) out.currency = result.currency
  const type = cleanText(result.type, 64)
  if (type) out.type = type
  if (result.isin && ISIN.test(result.isin)) out.isin = result.isin
  return out
}
