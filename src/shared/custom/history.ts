import { toUnixSeconds } from '../protocol/dates.js'
import { ConnectorError } from '../protocol/errors.js'
import type { HistoryAnswer } from '../protocol/types.js'
import { toMajor } from '../providers/currency.js'
import { CUSTOM_ANSWER_BYTES, getText, retryAfterSeconds, type TextAnswer } from '../providers/http.js'
import { finalizeSeries, type RawRow } from '../providers/series.js'
import type { FetchLike } from '../providers/types.js'
import { usesKey, type CustomSource } from './definition.js'
import { csvRows, jsonRows, MAX_COLUMNS, MAX_ROWS, TooLarge } from './parse.js'

export interface CustomContext {
  /** The user's key for this source, when it has one. */
  key?: string
  fetch: FetchLike
  now?: () => Date
  timeoutMs?: number
}

const PLACEHOLDER_RE = /\{([A-Z_]+)\}/g

function refuse(): ConnectorError {
  return new ConnectorError('BAD_REQUEST', 'That symbol cannot be used in this source\'s address.')
}

/** The symbol in a path: encoded, and never a `.` or `..` step, which would climb the path. */
function pathValue(symbol: string): string {
  if (symbol.split('/').some((part) => part === '' || part === '.' || part === '..')) throw refuse()
  return encodeURIComponent(symbol)
}

/**
 * Fill the address template. The host is fixed by the template (placeholders are not allowed
 * there), every value is encoded, and the result must keep the template's host and the literal
 * start of its path, so the symbol can never change where the request goes.
 */
export function buildUrl(source: CustomSource, values: { symbol: string; from: string; to: string; key?: string }): string {
  const queryStart = source.url.search(/[?#]/)
  const out = source.url.replace(PLACEHOLDER_RE, (_match, name: string, offset: number) => {
    const inPath = queryStart === -1 || offset < queryStart
    switch (name) {
      case 'SYMBOL':
        return inPath ? pathValue(values.symbol) : encodeURIComponent(values.symbol)
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
  const template = new URL(source.url.replace(PLACEHOLDER_RE, 'x'))
  const built = new URL(out)
  // The folder of the literal path before the first placeholder must still lead the built path
  // (the URL parser normalises both the same way, so a climbing `..` would show here).
  const firstPlaceholder = source.url.indexOf('{')
  const literal = firstPlaceholder === -1 ? source.url : source.url.slice(0, firstPlaceholder)
  const folder = new URL(literal).pathname.replace(/[^/]*$/, '')
  if (built.protocol !== 'https:' || built.host !== template.host || !built.pathname.startsWith(folder)) {
    throw refuse()
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
    maxBytes: CUSTOM_ANSWER_BYTES,
    accept: source.format === 'csv' ? 'text/csv, text/plain, */*' : 'application/json',
    unreachable: `Could not reach ${source.name}. Check its address: the connector never follows a redirect, so use the address the data finally comes from.`,
  })
  const err = failure(res, source.name)
  if (err) throw err

  let rows: RawRow[]
  try {
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
  } catch (e) {
    if (e instanceof TooLarge) {
      throw new ConnectorError(
        'PROVIDER_ERROR',
        e.what === 'rows'
          ? `${source.name} answered with more than ${MAX_ROWS.toLocaleString('en-US')} rows. Ask it for a shorter range.`
          : `${source.name} answered with rows of more than ${MAX_COLUMNS.toLocaleString('en-US')} columns.`,
      )
    }
    throw e
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
