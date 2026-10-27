import { secondsUntilUtcMidnight } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import { LIMITS, type HistoryAnswer, type SearchResult } from '../protocol/types.js'
import { BoundedCache, CURRENCY_CACHE_SIZE } from './cache.js'
import { toMajor, type MajorCurrency } from './currency.js'
import { asString, getJson, HISTORY_ANSWER_BYTES, isRecord, pathSegment, retryAfterSeconds, type JsonAnswer } from './http.js'
import { finalizeSeries } from './series.js'
import type { ProviderAdapter, ProviderContext } from './types.js'

const NAME = 'EODHD'
const BASE = 'https://eodhd.com/api'

/** EODHD's US virtual exchange is always dollars, so it needs no lookup. */
const EXCHANGE_CURRENCY: Readonly<Record<string, string>> = { US: 'USD' }

/** Symbol -> currency, kept once a history call for the symbol has worked. */
const currencyCache = new BoundedCache<string, MajorCurrency>(CURRENCY_CACHE_SIZE)

// A code starts with a letter or digit (AAPL, BRK-B, M&M, SE0021021417, BTC-USD, EURUSD);
// an exchange is letters and digits (US, LSE, XETRA, EUFUND, CC, FOREX).
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._\-&^+=]*$/
const EXCHANGE_RE = /^[A-Za-z0-9]+$/

function headers(ctx: ProviderContext): Record<string, string> {
  // EODHD accepts the key as a bearer token, so it never sits in a URL.
  return { Authorization: `Bearer ${ctx.apiKey}` }
}

function failure(res: JsonAnswer, now: Date): ConnectorError | undefined {
  if (res.status >= 200 && res.status < 300) return undefined
  switch (res.status) {
    case 401:
      return new ConnectorError('INVALID_KEY', 'EODHD refused the API key.')
    case 402:
      return new ConnectorError('RATE_LIMITED', "Your EODHD plan has used up today's API calls.", secondsUntilUtcMidnight(now))
    case 403:
      return new ConnectorError('PLAN_LIMIT', 'Your EODHD plan does not include this data.')
    case 404:
      return new ConnectorError('NOT_FOUND', 'EODHD does not know this symbol.')
    case 429:
      return new ConnectorError('RATE_LIMITED', 'EODHD asked to slow down.', retryAfterSeconds(res.headers, 60))
    default:
      return new ConnectorError('PROVIDER_ERROR', 'EODHD could not answer. Try again later.')
  }
}

/**
 * EODHD serves some fund names double-encoded: UTF-8 bytes read as Latin-1 upstream, so an
 * a-umlaut arrives as two characters. Only a string with the telltale pair is a candidate, and the
 * repair is kept only when it decodes cleanly.
 */
export function repairMojibake(name: string): string {
  if (!/[\u00C3\u00C2][\u0080-\u00BF]/.test(name)) return name
  const bytes = new Uint8Array(name.length)
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code > 0xff) return name
    bytes[i] = code
  }
  const repaired = new TextDecoder('utf-8').decode(bytes)
  return repaired.includes('\uFFFD') ? name : repaired
}

/** Split `AAPL.US` into code and exchange at the last dot (codes can hold dots: `BRK.B.US`). */
export function splitEodhdSymbol(symbol: string): { code: string; exchange: string } {
  const at = symbol.lastIndexOf('.')
  const code = symbol.slice(0, at)
  const exchange = symbol.slice(at + 1)
  if (at <= 0 || !CODE_RE.test(code) || !EXCHANGE_RE.test(exchange)) {
    throw new ConnectorError('BAD_REQUEST', 'EODHD symbols look like AAPL.US: the code, a dot, the exchange.')
  }
  return { code, exchange }
}

/** Currency a code implies on its own: the quote side of a forex pair or a crypto pair. */
function currencyFromCode(code: string, exchange: string): MajorCurrency | undefined {
  const ex = exchange.toUpperCase()
  if (ex === 'FOREX' && code.length === 6) return toMajor(code.slice(3))
  if (ex === 'CC') {
    const dash = code.lastIndexOf('-')
    if (dash > 0) return toMajor(code.slice(dash + 1))
  }
  return undefined
}

interface EodhdSearchItem {
  Code?: unknown
  Exchange?: unknown
  Name?: unknown
  Type?: unknown
  Currency?: unknown
  ISIN?: unknown
  /** The symbol lists spell it this way. */
  Isin?: unknown
}

async function searchRaw(query: string, ctx: ProviderContext, exchange?: string): Promise<EodhdSearchItem[]> {
  const params = new URLSearchParams({ fmt: 'json', limit: String(LIMITS.searchResults) })
  if (exchange) params.set('exchange', exchange)
  const res = await getJson(ctx, NAME, `${BASE}/search/${pathSegment(query)}?${params}`, headers(ctx))
  const err = failure(res, ctx.now?.() ?? new Date())
  if (err) throw err
  if (!Array.isArray(res.body)) throw new ConnectorError('PROVIDER_ERROR', 'EODHD sent an answer this connector does not understand.')
  return res.body.filter(isRecord) as EodhdSearchItem[]
}

async function resolveCurrency(code: string, exchange: string, ctx: ProviderContext): Promise<MajorCurrency> {
  const cached = currencyCache.get(`${code}.${exchange}`.toUpperCase())
  if (cached) return cached
  const fixed = EXCHANGE_CURRENCY[exchange.toUpperCase()]
  if (fixed) return { currency: fixed, divisor: 1 }
  const implied = currencyFromCode(code, exchange)
  if (implied) return implied
  const items = await searchRaw(code, ctx, exchange)
  const match = items.find(
    (i) => asString(i.Code)?.toUpperCase() === code.toUpperCase() && asString(i.Exchange)?.toUpperCase() === exchange.toUpperCase(),
  )
  const found = match ? toMajor(match.Currency) : undefined
  if (!found) throw new ConnectorError('NOT_FOUND', 'EODHD did not say which currency this symbol trades in.')
  return found
}

export const eodhd: ProviderAdapter = {
  id: 'eodhd',
  name: NAME,
  capabilities: { search: true, history: true },

  async search(query, ctx): Promise<SearchResult[]> {
    const items = await searchRaw(query, ctx)
    const results: SearchResult[] = []
    for (const item of items) {
      const code = asString(item.Code)
      const exchange = asString(item.Exchange)
      if (!code || !exchange) continue
      const currency = toMajor(item.Currency) ?? currencyFromCode(code, exchange) ?? toMajor(EXCHANGE_CURRENCY[exchange.toUpperCase()])
      const result: SearchResult = { symbol: `${code}.${exchange}`, name: repairMojibake(asString(item.Name) ?? code), exchange }
      if (currency) result.currency = currency.currency
      const type = asString(item.Type)
      if (type) result.type = type
      const isin = asString(item.ISIN) ?? asString(item.Isin)
      if (isin) result.isin = isin
      results.push(result)
      if (results.length >= LIMITS.searchResults) break
    }
    return results
  },

  async history(symbol, from, to, ctx): Promise<HistoryAnswer> {
    const { code, exchange } = splitEodhdSymbol(symbol)
    const currency = await resolveCurrency(code, exchange, ctx)
    const params = new URLSearchParams({ fmt: 'json', order: 'a', from, to })
    const res = await getJson(ctx, NAME, `${BASE}/eod/${pathSegment(symbol)}?${params}`, headers(ctx), HISTORY_ANSWER_BYTES)
    const err = failure(res, ctx.now?.() ?? new Date())
    if (err) throw err
    if (!Array.isArray(res.body)) throw new ConnectorError('PROVIDER_ERROR', 'EODHD sent an answer this connector does not understand.')
    currencyCache.set(`${code}.${exchange}`.toUpperCase(), currency)
    // `close` is the as-traded close; `adjusted_close` would rewrite history at every split.
    const rows = res.body.filter(isRecord).map((r) => ({ date: r.date, close: r.close }))
    return { symbol, currency: currency.currency, prices: finalizeSeries(rows, { from, to, divisor: currency.divisor }) }
  },
}

/** For tests: forget every learned currency. */
export function clearEodhdCurrencyCache(): void {
  currencyCache.clear()
}
