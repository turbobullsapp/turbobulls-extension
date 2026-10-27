import { toUnixSeconds } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import type { HistoryAnswer } from '../protocol/types.js'
import { toMajor } from '../providers/currency.js'
import { getText, HISTORY_ANSWER_BYTES, pathSegment, retryAfterSeconds, type TextAnswer } from '../providers/http.js'
import { finalizeSeries, type RawRow } from '../providers/series.js'
import type { FetchLike } from '../providers/types.js'
import { templateHost, usesKey, type CustomSource } from './definition.js'
import { csvRows, jsonRows } from './parse.js'

export interface CustomContext {
  /** The user's key for this source, when it has one. */
  key?: string
  fetch: FetchLike
  now?: () => Date
  timeoutMs?: number
}

/**
 * Fill the address template. The host is fixed by the template (placeholders are not allowed
 * there), and every value is encoded, so the symbol can never change where the request goes.
 */
export function buildUrl(source: CustomSource, values: { symbol: string; from: string; to: string; key?: string }): string {
  const queryStart = source.url.search(/[?#]/)
  const out = source.url.replace(/\{([A-Z_]+)\}/g, (_match, name: string, offset: number) => {
    const inPath = queryStart === -1 || offset < queryStart
    switch (name) {
      case 'SYMBOL':
        return inPath ? pathSegment(values.symbol) : encodeURIComponent(values.symbol)
      case 'FROM':
        return values.from
      case 'TO':
        return values.to
      case 'FROM_UNIX':
        return String(toUnixSeconds(values.from))
      case 'TO_UNIX':
        return String(toUnixSeconds(values.to) + 86_399)
      case 'KEY':
        return encodeURIComponent(values.key ?? '')
      default:
        throw new ConnectorError('BAD_REQUEST', 'The source address has an unknown placeholder.')
    }
  })
  const parsed = new URL(out)
  if (parsed.protocol !== 'https:' || parsed.host.toLowerCase() !== (templateHost(source.url) ?? '').toLowerCase()) {
    throw new ConnectorError('BAD_REQUEST', 'The source address did not keep its host.')
  }
  return out
}

function failure(res: TextAnswer, name: string): ConnectorError | undefined {
  if (res.status >= 200 && res.status < 300) return undefined
  switch (res.status) {
    case 401:
      return new ConnectorError('INVALID_KEY', `${name} refused the key.`)
    case 403:
      return new ConnectorError('PLAN_LIMIT', `${name} refused access to this data.`)
    case 404:
      return new ConnectorError('NOT_FOUND', `${name} has nothing at that address for this symbol.`)
    case 429:
      return new ConnectorError('RATE_LIMITED', `${name} asked to slow down.`, retryAfterSeconds(res.headers, 60))
    default:
      return new ConnectorError('PROVIDER_ERROR', `${name} answered with an error (HTTP ${res.status}).`)
  }
}

/** Daily closes from a custom source, read and checked like any provider's. */
export async function customHistory(
  source: CustomSource,
  symbol: string,
  from: string,
  to: string,
  ctx: CustomContext,
): Promise<HistoryAnswer> {
  const currency = toMajor(source.currency)
  if (!currency) throw new ConnectorError('BAD_REQUEST', `${source.name} has no valid currency in its settings.`)
  const needsKey = usesKey(source)
  const key = ctx.key?.trim()
  if (needsKey && !key) throw new ConnectorError('NOT_CONFIGURED', `${source.name} needs a key: add it in the connector.`)

  const url = buildUrl(source, key ? { symbol, from, to, key } : { symbol, from, to })
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(source.headers)) headers[name] = value.split('{KEY}').join(key ?? '')

  const httpCtx = { apiKey: key ?? '', fetch: ctx.fetch, ...(ctx.now ? { now: ctx.now } : {}), ...(ctx.timeoutMs !== undefined ? { timeoutMs: ctx.timeoutMs } : {}) }
  const res = await getText(httpCtx, source.name, url, headers, {
    maxBytes: HISTORY_ANSWER_BYTES,
    // A redirect may only be followed when no key travels with the request.
    redirect: needsKey ? 'error' : 'follow',
    accept: source.format === 'csv' ? 'text/csv, text/plain, */*' : 'application/json',
  })
  const err = failure(res, source.name)
  if (err) throw err

  let rows: RawRow[]
  if (source.format === 'csv' && source.csv) {
    rows = csvRows(res.text, source.csv, source.dateFormat, source.decimal)
  } else if (source.json) {
    let body: unknown
    try {
      body = JSON.parse(res.text)
    } catch {
      throw new ConnectorError('PROVIDER_ERROR', `${source.name} did not answer with JSON. Check the format in its settings.`)
    }
    rows = jsonRows(body, source.json, source.dateFormat, source.decimal)
  } else {
    throw new ConnectorError('BAD_REQUEST', `${source.name} has incomplete settings.`)
  }

  const readable = rows.filter((r) => r.date !== undefined && r.close !== undefined)
  if (readable.length === 0 && res.text.trim().length > 0) {
    throw new ConnectorError(
      'PROVIDER_ERROR',
      `Found no dates and prices where the settings for ${source.name} point. Check the paths, the date format and the decimal separator.`,
    )
  }
  return { symbol, currency: currency.currency, prices: finalizeSeries(readable, { from, to, divisor: currency.divisor }) }
}
