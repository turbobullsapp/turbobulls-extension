import { ConnectorError } from '../protocol/errors.js'
import type { HttpResponseLike, ProviderContext } from './types.js'

export interface JsonAnswer {
  status: number
  headers: { get(name: string): string | null }
  /** The parsed JSON, or undefined when the answer was not JSON (EODHD answers some errors in plain text). */
  body: unknown
}

export interface TextAnswer {
  status: number
  headers: { get(name: string): string | null }
  text: string
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Largest answer read for a search or a lookup. */
export const SMALL_ANSWER_BYTES = 1024 * 1024
/** Largest answer read for a price history (a 20,000-day series is a few megabytes). */
export const HISTORY_ANSWER_BYTES = 10 * 1024 * 1024
/** Largest answer read from a custom source: plenty for daily prices, and bounded for parsing. */
export const CUSTOM_ANSWER_BYTES = 4 * 1024 * 1024

const MAX_RETRY_AFTER = 86_400

function tooLarge(providerName: string): ConnectorError {
  return new ConnectorError('PROVIDER_ERROR', `${providerName} sent an answer too large to use.`)
}

/** Read the answer, stopping as soon as it passes `maxBytes` rather than buffering all of it. */
async function readText(res: HttpResponseLike, maxBytes: number, providerName: string, abort: () => void): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    abort()
    throw tooLarge(providerName)
  }
  if (!res.body) {
    const text = await res.text()
    if (text.length > maxBytes) throw tooLarge(providerName)
    return text
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      abort()
      throw tooLarge(providerName)
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(all)
}

export interface GetOptions {
  maxBytes?: number
  accept?: string
  /** What to say when the address cannot be reached (a network failure, or a refused redirect). */
  unreachable?: string
}

/**
 * GET a URL and read the answer as text. Redirects are always refused: a request, and any key in
 * it, goes only to the address that was built, never to wherever a redirect points. No cookies are
 * ever sent. Network failures and timeouts become a PROVIDER_ERROR that names the source only,
 * never the URL, which can carry a key for sources that only accept it as a query parameter.
 */
export async function getText(
  ctx: ProviderContext,
  providerName: string,
  url: string,
  headers: Record<string, string> = {},
  options: GetOptions = {},
): Promise<TextAnswer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await ctx.fetch(url, {
      method: 'GET',
      headers: { Accept: options.accept ?? 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    })
    if (res.status >= 300 && res.status < 400) {
      throw new ConnectorError('PROVIDER_ERROR', `${providerName} answered with a redirect, which the connector does not follow.`)
    }
    const text = await readText(res, options.maxBytes ?? SMALL_ANSWER_BYTES, providerName, () => controller.abort())
    return { status: res.status, headers: res.headers, text }
  } catch (e) {
    if (e instanceof ConnectorError) throw e
    if (controller.signal.aborted) {
      throw new ConnectorError('PROVIDER_ERROR', `${providerName} did not answer in time.`)
    }
    throw new ConnectorError('PROVIDER_ERROR', options.unreachable ?? `Could not reach ${providerName}. Check the internet connection.`)
  } finally {
    clearTimeout(timer)
  }
}

/** GET a provider URL and parse the answer as JSON (see getText for the rules it follows). */
export async function getJson(
  ctx: ProviderContext,
  providerName: string,
  url: string,
  headers: Record<string, string> = {},
  maxBytes: number = SMALL_ANSWER_BYTES,
): Promise<JsonAnswer> {
  const answer = await getText(ctx, providerName, url, headers, { maxBytes })
  let body: unknown
  try {
    body = answer.text.length > 0 ? JSON.parse(answer.text) : undefined
  } catch {
    body = undefined
  }
  return { status: answer.status, headers: answer.headers, body }
}

/** Seconds from a Retry-After header (seconds or an HTTP date), or the fallback; 1 second to 1 day. */
export function retryAfterSeconds(headers: { get(name: string): string | null }, fallback: number, now = Date.now()): number {
  return clampRetryAfter(parseRetryAfter(headers.get('retry-after'), now) ?? fallback)
}

function parseRetryAfter(raw: string | null, now: number): number | undefined {
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.ceil(seconds)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.ceil((at - now) / 1000) : undefined
}

export function clampRetryAfter(seconds: number): number {
  if (!Number.isFinite(seconds)) return MAX_RETRY_AFTER
  return Math.min(MAX_RETRY_AFTER, Math.max(1, Math.ceil(seconds)))
}

/**
 * One URL path segment from user input. encodeURIComponent leaves dots alone, and a segment of
 * only dots would make the URL climb out of the provider's API path.
 */
export function pathSegment(value: string): string {
  const encoded = encodeURIComponent(value)
  if (encoded === '' || /^\.+$/.test(encoded)) {
    throw new ConnectorError('BAD_REQUEST', 'That value cannot be sent to the provider.')
  }
  return encoded
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
