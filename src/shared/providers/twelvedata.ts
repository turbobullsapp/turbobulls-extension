import { addDays, secondsUntilUtcMidnight } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import { LIMITS, type HistoryAnswer, type SearchResult } from '../protocol/types.js'
import { toMajor, type MajorCurrency } from './currency.js'
import { asString, getJson, isRecord, retryAfterSeconds, type JsonAnswer } from './http.js'
import { finalizeSeries, type RawRow } from './series.js'
import type { ProviderAdapter, ProviderContext } from './types.js'

const NAME = 'Twelve Data'
const BASE = 'https://api.twelvedata.com'
const PAGE_SIZE = 5000
const MAX_PAGES = 10

function headers(ctx: ProviderContext): Record<string, string> {
  // Twelve Data accepts the key in a header, so it never sits in a URL.
  return { Authorization: `apikey ${ctx.apiKey}` }
}

/**
 * Twelve Data reports errors as `{ status: "error", code, message }`, sometimes with HTTP 200.
 * Returns 'empty' for its "no data is available" answer, which only means the range is empty.
 */
function failure(res: JsonAnswer, now: Date): ConnectorError | 'empty' | undefined {
  const body = isRecord(res.body) ? res.body : undefined
  const isError = body?.status === 'error' || res.status < 200 || res.status >= 300
  if (!isError) return undefined
  const code = typeof body?.code === 'number' ? body.code : res.status
  const message = typeof body?.message === 'string' ? body.message : ''
  if (code === 400 && /no data is available/i.test(message)) return 'empty'
  switch (code) {
    case 401:
      return new ConnectorError('INVALID_KEY', 'Twelve Data refused the API key.')
    case 403:
      return new ConnectorError('PLAN_LIMIT', 'Your Twelve Data plan does not include this data.')
    case 404:
      return new ConnectorError('NOT_FOUND', 'Twelve Data does not know this symbol.')
    case 429:
      return /day/i.test(message)
        ? new ConnectorError('RATE_LIMITED', "Your Twelve Data plan has used up today's API credits.", secondsUntilUtcMidnight(now))
        : new ConnectorError('RATE_LIMITED', "Your Twelve Data plan has used up this minute's API credits.", retryAfterSeconds(res.headers, 60))
    case 400:
      return /not found/i.test(message)
        ? new ConnectorError('NOT_FOUND', 'Twelve Data does not know this symbol.')
        : new ConnectorError('PROVIDER_ERROR', 'Twelve Data could not answer this request.')
    default:
      return new ConnectorError('PROVIDER_ERROR', 'Twelve Data could not answer. Try again later.')
  }
}

/** `TSCO:LSE` -> TSCO on LSE; `BTC/USD:Binance` -> BTC/USD on Binance; `EUR/USD` -> no exchange. */
export function splitTwelveDataSymbol(symbol: string): { symbol: string; exchange?: string } {
  const at = symbol.lastIndexOf(':')
  if (at > 0 && at < symbol.length - 1) return { symbol: symbol.slice(0, at), exchange: symbol.slice(at + 1) }
  return { symbol }
}

/** Currency of a time series: `meta.currency`, or the quote side of a pair (EUR/USD -> USD). */
function seriesCurrency(meta: Record<string, unknown> | undefined, symbol: string): MajorCurrency | undefined {
  const fromMeta = toMajor(meta?.currency)
  if (fromMeta) return fromMeta
  const slash = symbol.indexOf('/')
  return slash > 0 ? toMajor(symbol.slice(slash + 1)) : undefined
}

export const twelvedata: ProviderAdapter = {
  id: 'twelvedata',
  name: NAME,
  capabilities: { search: true, history: true },

  async search(query, ctx): Promise<SearchResult[]> {
    const params = new URLSearchParams({ symbol: query, outputsize: String(LIMITS.searchResults) })
    const res = await getJson(ctx, NAME, `${BASE}/symbol_search?${params}`, headers(ctx))
    const err = failure(res, ctx.now?.() ?? new Date())
    if (err === 'empty') return []
    if (err) throw err
    const data = isRecord(res.body) && Array.isArray(res.body.data) ? res.body.data.filter(isRecord) : undefined
    if (!data) throw new ConnectorError('PROVIDER_ERROR', 'Twelve Data sent an answer this connector does not understand.')
    const results: SearchResult[] = []
    for (const item of data) {
      const symbol = asString(item.symbol)
      if (!symbol) continue
      const exchange = asString(item.exchange)
      const result: SearchResult = { symbol: exchange ? `${symbol}:${exchange}` : symbol, name: asString(item.instrument_name) ?? symbol }
      if (exchange) result.exchange = exchange
      const mic = asString(item.mic_code)
      if (mic) result.mic = mic
      const currency = toMajor(item.currency) ?? seriesCurrency(undefined, symbol)
      if (currency) result.currency = currency.currency
      const type = asString(item.instrument_type)
      if (type) result.type = type
      results.push(result)
      if (results.length >= LIMITS.searchResults) break
    }
    return results
  },

  async history(symbol, from, to, ctx): Promise<HistoryAnswer> {
    const { symbol: ticker, exchange } = splitTwelveDataSymbol(symbol)
    const now = ctx.now?.() ?? new Date()
    const rows: RawRow[] = []
    let currency: MajorCurrency | undefined
    // Newest first, one page of up to 5000 days at a time, walking back until `from`.
    let endDate = addDays(to, 1)
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        symbol: ticker,
        interval: '1day',
        outputsize: String(PAGE_SIZE),
        start_date: from,
        end_date: endDate,
        // As-traded closes. Twelve Data's default rewrites history at every split.
        adjust: 'none',
        order: 'desc',
      })
      if (exchange) params.set('exchange', exchange)
      const res = await getJson(ctx, NAME, `${BASE}/time_series?${params}`, headers(ctx))
      const err = failure(res, now)
      if (err === 'empty') break
      if (err) throw err
      const body = isRecord(res.body) ? res.body : undefined
      const values = body && Array.isArray(body.values) ? body.values.filter(isRecord) : undefined
      if (!values) throw new ConnectorError('PROVIDER_ERROR', 'Twelve Data sent an answer this connector does not understand.')
      currency ??= seriesCurrency(isRecord(body?.meta) ? body.meta : undefined, ticker)
      for (const v of values) rows.push({ date: v.datetime, close: v.close })
      if (values.length < PAGE_SIZE) break
      const oldest = asString(values[values.length - 1]?.datetime)?.slice(0, 10)
      if (!oldest || oldest <= from) break
      endDate = oldest
    }
    if (rows.length === 0) {
      return { symbol, currency: currency?.currency ?? (await currencyFromSearch(symbol, ctx)).currency, prices: [] }
    }
    if (!currency) throw new ConnectorError('NOT_FOUND', 'Twelve Data did not say which currency this symbol trades in.')
    return { symbol, currency: currency.currency, prices: finalizeSeries(rows, { from, to, divisor: currency.divisor }) }
  },
}

/** An empty range has no meta to read the currency from, so ask the search instead. */
async function currencyFromSearch(symbol: string, ctx: ProviderContext): Promise<MajorCurrency> {
  const results = await twelvedata.search(splitTwelveDataSymbol(symbol).symbol, ctx)
  const match = results.find((r) => r.symbol === symbol)
  const currency = toMajor(match?.currency)
  if (!currency) throw new ConnectorError('NOT_FOUND', 'Twelve Data did not say which currency this symbol trades in.')
  return currency
}
