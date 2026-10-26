import { daysBetween, secondsUntilUtcMidnight, todayUtc } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import { LIMITS, type HistoryAnswer, type SearchResult } from '../protocol/types.js'
import { toMajor, type MajorCurrency } from './currency.js'
import { asString, getJson, isRecord, type JsonAnswer } from './http.js'
import { finalizeSeries } from './series.js'
import type { ProviderAdapter, ProviderContext } from './types.js'

const NAME = 'Alpha Vantage'
const BASE = 'https://www.alphavantage.co/query'
/** "compact" returns the latest 100 trading days, about 140 calendar days. */
const COMPACT_DAYS = 140

const currencyCache = new Map<string, MajorCurrency>()

/**
 * Alpha Vantage only takes the key as a query parameter, so this URL holds it. It is built here
 * and handed to fetch; no message or log line ever includes it.
 */
function url(params: Record<string, string>, ctx: ProviderContext): string {
  return `${BASE}?${new URLSearchParams({ ...params, apikey: ctx.apiKey })}`
}

/** Alpha Vantage answers HTTP 200 for everything and puts problems in the body. */
function failure(res: JsonAnswer, now: Date): ConnectorError | undefined {
  if (res.status < 200 || res.status >= 300) {
    return new ConnectorError('PROVIDER_ERROR', 'Alpha Vantage could not answer. Try again later.')
  }
  const body = isRecord(res.body) ? res.body : undefined
  if (!body) return new ConnectorError('PROVIDER_ERROR', 'Alpha Vantage sent an answer this connector does not understand.')
  const error = asString(body['Error Message'])
  if (error) {
    return /api ?key/i.test(error)
      ? new ConnectorError('INVALID_KEY', 'Alpha Vantage refused the API key.')
      : new ConnectorError('NOT_FOUND', 'Alpha Vantage does not know this symbol.')
  }
  const note = asString(body.Information) ?? asString(body.Note)
  if (!note) return undefined
  if (/premium/i.test(note)) return new ConnectorError('PLAN_LIMIT', 'Your Alpha Vantage plan does not include this data.')
  if (/rate limit|requests per|call frequency|per day|per minute|spread out/i.test(note)) {
    return /per day|daily/i.test(note)
      ? new ConnectorError('RATE_LIMITED', "Your Alpha Vantage plan has used up today's requests.", secondsUntilUtcMidnight(now))
      : new ConnectorError('RATE_LIMITED', 'Alpha Vantage asked to slow down.', 60)
  }
  if (/api ?key/i.test(note)) return new ConnectorError('INVALID_KEY', 'Alpha Vantage refused the API key.')
  return new ConnectorError('PROVIDER_ERROR', 'Alpha Vantage could not answer this request.')
}

interface Match {
  symbol: string
  name?: string
  type?: string
  region?: string
  currency?: MajorCurrency
}

async function searchRaw(keywords: string, ctx: ProviderContext): Promise<Match[]> {
  const res = await getJson(ctx, NAME, url({ function: 'SYMBOL_SEARCH', keywords }, ctx))
  const err = failure(res, ctx.now?.() ?? new Date())
  if (err) throw err
  const body = res.body as Record<string, unknown>
  const matches = Array.isArray(body.bestMatches) ? body.bestMatches.filter(isRecord) : []
  const out: Match[] = []
  for (const m of matches) {
    const symbol = asString(m['1. symbol'])
    if (!symbol) continue
    const match: Match = { symbol }
    const name = asString(m['2. name'])
    if (name) match.name = name
    const type = asString(m['3. type'])
    if (type) match.type = type
    const region = asString(m['4. region'])
    if (region) match.region = region
    const currency = toMajor(m['8. currency'])
    if (currency) match.currency = currency
    out.push(match)
  }
  return out
}

async function resolveCurrency(symbol: string, ctx: ProviderContext): Promise<MajorCurrency> {
  const key = symbol.toUpperCase()
  const cached = currencyCache.get(key)
  if (cached) return cached
  // US listings carry no exchange suffix (IBM) and trade in dollars; every other market has one
  // (TSCO.LON), so only those cost a lookup.
  const found = symbol.includes('.')
    ? (await searchRaw(symbol, ctx)).find((m) => m.symbol.toUpperCase() === key)?.currency
    : { currency: 'USD', divisor: 1 }
  if (!found) throw new ConnectorError('NOT_FOUND', 'Alpha Vantage did not say which currency this symbol trades in.')
  currencyCache.set(key, found)
  return found
}

async function dailySeries(symbol: string, outputsize: 'compact' | 'full', ctx: ProviderContext): Promise<Record<string, unknown>> {
  const res = await getJson(ctx, NAME, url({ function: 'TIME_SERIES_DAILY', symbol, outputsize, datatype: 'json' }, ctx))
  const err = failure(res, ctx.now?.() ?? new Date())
  if (err) throw err
  const series = (res.body as Record<string, unknown>)['Time Series (Daily)']
  return isRecord(series) ? series : {}
}

export const alphavantage: ProviderAdapter = {
  id: 'alphavantage',
  name: NAME,
  capabilities: { search: true, history: true },

  async search(query, ctx): Promise<SearchResult[]> {
    const matches = await searchRaw(query, ctx)
    return matches.slice(0, LIMITS.searchResults).map((m) => {
      const result: SearchResult = { symbol: m.symbol, name: m.name ?? m.symbol }
      if (m.region) result.exchange = m.region
      if (m.currency) result.currency = m.currency.currency
      if (m.type) result.type = m.type
      return result
    })
  },

  async history(symbol, from, to, ctx): Promise<HistoryAnswer> {
    const currency = await resolveCurrency(symbol, ctx)
    const today = todayUtc(ctx.now?.() ?? new Date())
    let series: Record<string, unknown>
    if (daysBetween(from, today) > COMPACT_DAYS) {
      try {
        series = await dailySeries(symbol, 'full', ctx)
      } catch (e) {
        // Some plans only get the latest 100 days; give those rather than nothing.
        if (!(e instanceof ConnectorError) || e.code !== 'PLAN_LIMIT') throw e
        series = await dailySeries(symbol, 'compact', ctx)
      }
    } else {
      series = await dailySeries(symbol, 'compact', ctx)
    }
    const rows = Object.entries(series).map(([date, day]) => ({
      date,
      // TIME_SERIES_DAILY is as traded; the adjusted series would rewrite history at every split.
      close: isRecord(day) ? day['4. close'] : undefined,
    }))
    return { symbol, currency: currency.currency, prices: finalizeSeries(rows, { from, to, divisor: currency.divisor }) }
  },
}

/** For tests: forget every learned currency. */
export function clearAlphaVantageCurrencyCache(): void {
  currencyCache.clear()
}
