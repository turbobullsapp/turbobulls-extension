import { addDays, isIsoDate, todayUtc } from './dates.js'
import { ConnectorError } from './errors.js'
import {
  LIMITS,
  OPS,
  PROTOCOL_VERSION,
  PROVIDER_IDS,
  type HistoryParams,
  type Op,
  type ProviderId,
  type SearchParams,
} from './types.js'

/** A request whose envelope and parameters have been checked. */
export type ValidRequest =
  | { id: string; op: 'hello' }
  | { id: string; op: 'openSettings' }
  | { id: string; op: 'search'; params: SearchParams }
  | { id: string; op: 'history'; params: HistoryParams }

const ID_RE = /^[A-Za-z0-9_-]+$/
// Letters, digits and the punctuation real tickers use: BRK-B.US, BTC/USD:Binance, M&M.NSE,
// OANDA:EUR_USD, ^GSPC. Spaces appear in some exchange names ("Coinbase Pro").
const SYMBOL_RE = /^[A-Za-z0-9 .\-_:/^=&+]+$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const ALNUM_RE = /[A-Za-z0-9]/
const EARLIEST_DATE = '1900-01-01'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bad(message: string): ConnectorError {
  return new ConnectorError('BAD_REQUEST', message)
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
}

function readProvider(params: Record<string, unknown>): ProviderId {
  if (!isProviderId(params.provider)) throw bad('Unknown provider.')
  return params.provider
}

function readQuery(params: Record<string, unknown>): string {
  const q = params.query
  if (typeof q !== 'string') throw bad('The search needs a query.')
  const query = q.trim()
  if (query.length > LIMITS.queryLength || CONTROL_RE.test(query) || !ALNUM_RE.test(query)) {
    throw bad(`The query must be 1 to ${LIMITS.queryLength} plain characters.`)
  }
  return query
}

/** A ticker: the characters tickers use, a letter or digit, and never "//" (which only a URL has). */
export function isValidSymbol(symbol: string): boolean {
  return (
    symbol.length <= LIMITS.symbolLength &&
    SYMBOL_RE.test(symbol) &&
    ALNUM_RE.test(symbol) &&
    !symbol.includes('//') &&
    symbol === symbol.trim()
  )
}

function readSymbol(params: Record<string, unknown>): string {
  const s = params.symbol
  if (typeof s !== 'string') throw bad('The request needs a symbol.')
  const symbol = s.trim()
  if (!isValidSymbol(symbol)) throw bad('That symbol has characters no ticker uses.')
  return symbol
}

function readHistory(params: Record<string, unknown>, now: Date): HistoryParams {
  const provider = readProvider(params)
  const symbol = readSymbol(params)
  const latest = addDays(todayUtc(now), 1)
  const from = params.from
  if (!isIsoDate(from)) throw bad('"from" must be a date written YYYY-MM-DD.')
  if (from < EARLIEST_DATE || from > latest) throw bad('"from" is out of range.')
  let to: string | undefined
  if (params.to !== undefined && params.to !== null) {
    if (!isIsoDate(params.to)) throw bad('"to" must be a date written YYYY-MM-DD.')
    if (params.to < from) throw bad('"to" is before "from".')
    to = params.to > latest ? latest : params.to
  }
  return to === undefined ? { provider, symbol, from } : { provider, symbol, from, to }
}

/**
 * Check a request from the app. Throws a ConnectorError (BAD_REQUEST, UNSUPPORTED_PROTOCOL or
 * UNSUPPORTED_OPERATION) that names what is wrong without echoing the input back.
 */
export function validateRequest(input: unknown, now: Date = new Date()): ValidRequest {
  if (!isRecord(input)) throw bad('A request is a JSON object.')
  if (input.v !== PROTOCOL_VERSION) {
    throw new ConnectorError(
      'UNSUPPORTED_PROTOCOL',
      `This connector speaks protocol ${PROTOCOL_VERSION}. Update the connector or the app.`,
    )
  }
  const id = input.id
  if (typeof id !== 'string' || id.length === 0 || id.length > LIMITS.requestIdLength || !ID_RE.test(id)) {
    throw bad('The request id is missing or malformed.')
  }
  const op = input.op
  if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) {
    throw new ConnectorError('UNSUPPORTED_OPERATION', 'This connector does not know that operation.')
  }
  const params = isRecord(input.params) ? input.params : {}
  switch (op as Op) {
    case 'hello':
      return { id, op: 'hello' }
    case 'openSettings':
      return { id, op: 'openSettings' }
    case 'search':
      return { id, op: 'search', params: { provider: readProvider(params), query: readQuery(params) } }
    case 'history':
      return { id, op: 'history', params: readHistory(params, now) }
  }
}

/** The id to answer with, even when the request itself was invalid. */
export function requestIdOf(input: unknown): string {
  if (isRecord(input) && typeof input.id === 'string' && input.id.length <= LIMITS.requestIdLength && ID_RE.test(input.id)) {
    return input.id
  }
  return ''
}
