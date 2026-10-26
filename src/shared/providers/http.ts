import { ConnectorError } from '../protocol/errors.js'
import type { ProviderContext } from './types.js'

export interface JsonAnswer {
  status: number
  headers: { get(name: string): string | null }
  /** The parsed JSON, or undefined when the answer was not JSON (EODHD answers some errors in plain text). */
  body: unknown
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_ANSWER_CHARS = 32 * 1024 * 1024

/**
 * GET a provider URL and parse the answer. Network failures and timeouts become a PROVIDER_ERROR
 * that names the provider only: never the URL, which can carry the key for providers that only
 * accept it as a query parameter.
 */
export async function getJson(
  ctx: ProviderContext,
  providerName: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<JsonAnswer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await ctx.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    })
    const text = await res.text()
    if (text.length > MAX_ANSWER_CHARS) {
      throw new ConnectorError('PROVIDER_ERROR', `${providerName} sent an answer too large to use.`)
    }
    let body: unknown
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
    return { status: res.status, headers: res.headers, body }
  } catch (e) {
    if (e instanceof ConnectorError) throw e
    if (controller.signal.aborted) {
      throw new ConnectorError('PROVIDER_ERROR', `${providerName} did not answer in time.`)
    }
    throw new ConnectorError('PROVIDER_ERROR', `Could not reach ${providerName}. Check the internet connection.`)
  } finally {
    clearTimeout(timer)
  }
}

/** Seconds from a Retry-After header (seconds or an HTTP date), or the fallback. */
export function retryAfterSeconds(headers: { get(name: string): string | null }, fallback: number, now = Date.now()): number {
  const raw = headers.get('retry-after')
  if (raw) {
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
    const at = Date.parse(raw)
    if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - now) / 1000))
  }
  return fallback
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
