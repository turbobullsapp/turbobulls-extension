import { toUnixSeconds, fromUnixSeconds } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import { LIMITS, type HistoryAnswer, type SearchResult } from '../protocol/types.js'
import { toMajor, type MajorCurrency } from './currency.js'
import { asString, getJson, isRecord, retryAfterSeconds, type JsonAnswer } from './http.js'
import { finalizeSeries, type RawRow } from './series.js'
import type { ProviderAdapter, ProviderContext } from './types.js'

const NAME = 'Finnhub'
const BASE = 'https://finnhub.io/api/v1'

const currencyCache = new Map<string, MajorCurrency>()

function headers(ctx: ProviderContext): Record<string, string> {
  // Finnhub accepts the key in a header, so it never sits in a URL.
  return { 'X-Finnhub-Token': ctx.apiKey }
}

function failure(res: JsonAnswer): ConnectorError | undefined {
  if (res.status >= 200 && res.status < 300) {
    return isRecord(res.body) && asString(res.body.error)
      ? new ConnectorError('PROVIDER_ERROR', 'Finnhub could not answer this request.')
      : undefined
  }
  switch (res.status) {
    case 401:
      return new ConnectorError('INVALID_KEY', 'Finnhub refused the API key.')
    case 403:
      return new ConnectorError('PLAN_LIMIT', 'Your Finnhub plan does not include this data.')
    case 404:
      return new ConnectorError('NOT_FOUND', 'Finnhub does not know this symbol.')
    case 429:
      return new ConnectorError('RATE_LIMITED', 'Finnhub asked to slow down.', retryAfterSeconds(res.headers, 60))
    default:
      return new ConnectorError('PROVIDER_ERROR', 'Finnhub could not answer. Try again later.')
  }
}

async function resolveCurrency(symbol: string, ctx: ProviderContext): Promise<MajorCurrency> {
  const key = symbol.toUpperCase()
  const cached = currencyCache.get(key)
  if (cached) return cached
  const res = await getJson(ctx, NAME, `${BASE}/stock/profile2?${new URLSearchParams({ symbol })}`, headers(ctx))
  // A plan without company profiles still has candles: fall back to the symbol's shape below.
  const err = failure(res)
  if (err && err.code !== 'PLAN_LIMIT') throw err
  let found = !err && isRecord(res.body) ? toMajor(res.body.currency) : undefined
  // US listings carry no exchange suffix (AAPL) and trade in dollars.
  if (!found && /^[A-Z0-9-]+$/i.test(symbol)) found = { currency: 'USD', divisor: 1 }
  if (!found) throw new ConnectorError('NOT_FOUND', 'Finnhub did not say which currency this symbol trades in.')
  currencyCache.set(key, found)
  return found
}

export const finnhub: ProviderAdapter = {
  id: 'finnhub',
  name: NAME,
  capabilities: { search: true, history: true },

  async search(query, ctx): Promise<SearchResult[]> {
    const res = await getJson(ctx, NAME, `${BASE}/search?${new URLSearchParams({ q: query })}`, headers(ctx))
    const err = failure(res)
    if (err) throw err
    const items = isRecord(res.body) && Array.isArray(res.body.result) ? res.body.result.filter(isRecord) : undefined
    if (!items) throw new ConnectorError('PROVIDER_ERROR', 'Finnhub sent an answer this connector does not understand.')
    const results: SearchResult[] = []
    for (const item of items) {
      const symbol = asString(item.symbol)
      if (!symbol) continue
      const result: SearchResult = { symbol, name: asString(item.description) ?? symbol }
      const type = asString(item.type)
      if (type) result.type = type
      results.push(result)
      if (results.length >= LIMITS.searchResults) break
    }
    return results
  },

  async history(symbol, from, to, ctx): Promise<HistoryAnswer> {
    const currency = await resolveCurrency(symbol, ctx)
    const params = new URLSearchParams({
      symbol,
      resolution: 'D',
      from: String(toUnixSeconds(from)),
      to: String(toUnixSeconds(to) + 86_399),
    })
    const res = await getJson(ctx, NAME, `${BASE}/stock/candle?${params}`, headers(ctx))
    const err = failure(res)
    if (err) throw err
    const body = isRecord(res.body) ? res.body : undefined
    if (body?.s === 'no_data') return { symbol, currency: currency.currency, prices: [] }
    if (body?.s !== 'ok' || !Array.isArray(body.t) || !Array.isArray(body.c)) {
      throw new ConnectorError('PROVIDER_ERROR', 'Finnhub sent an answer this connector does not understand.')
    }
    const times = body.t
    const closes = body.c
    const rows: RawRow[] = times.map((t, i) => ({
      date: typeof t === 'number' ? fromUnixSeconds(t) : undefined,
      close: closes[i],
    }))
    return { symbol, currency: currency.currency, prices: finalizeSeries(rows, { from, to, divisor: currency.divisor }) }
  },
}

/** For tests: forget every learned currency. */
export function clearFinnhubCurrencyCache(): void {
  currencyCache.clear()
}
