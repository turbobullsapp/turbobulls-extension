import { ConnectorError, isConnectorError } from './protocol/errors.js'
import type { ErrorCode, SourceId } from './protocol/types.js'
import { BoundedCache } from './providers/cache.js'

/** How long a refused key, or a symbol outside the user's plan, is not asked about again. */
export const REFUSAL_PAUSE_MS = 5 * 60_000
/** The longest a rate limit is kept here, even when the provider names a later time. */
export const MAX_RATE_LIMIT_PAUSE_MS = 60 * 60_000
/** Symbols remembered as outside a plan; the least recently used is forgotten past this. */
const SYMBOL_ENTRIES = 500

interface Refusal {
  code: ErrorCode
  message: string
  /** Until when the request is answered here instead of being sent. */
  until: number
  /** When the provider said it may be asked again; reported to the app as `retryAfter`. */
  retryAt?: number
  /** Fingerprint of the key that was refused: any other key is asked about at once. */
  keyPrint: string
}

/**
 * Remembers a provider's refusals, so a request that would only be refused again is answered here
 * instead of being sent: a rate limit until its retry time (an hour at most), a refused key for five
 * minutes or until the key changes, a symbol outside the user's plan for five minutes. The app backs
 * off too; this keeps the user's allowance, and their standing with the provider, safe when it does
 * not. Connectors that answer the app keep one; a settings page testing a key leaves it out, so the
 * user's own click always reaches the provider.
 */
export interface RefusalMemory {
  /** Throws the remembered refusal while it still applies to this source, key and symbol. */
  check(source: SourceId, keyPrint: string, symbol: string | undefined, now: number): void
  /** Keeps a refusal that asking again would only repeat; other errors are ignored. */
  remember(source: SourceId, keyPrint: string, symbol: string | undefined, error: unknown, now: number): void
}

export function createRefusalMemory(): RefusalMemory {
  // A source id never holds a space, so the first space ends it.
  const symbolKey = (source: SourceId, symbol: string) => `${source} ${symbol}`
  const bySource = new Map<SourceId, Refusal>()
  const bySymbol = new BoundedCache<string, Refusal>(SYMBOL_ENTRIES)

  const applies = (refusal: Refusal | undefined, keyPrint: string, now: number): refusal is Refusal =>
    refusal !== undefined && refusal.until > now && refusal.keyPrint === keyPrint

  const asError = (refusal: Refusal, now: number): ConnectorError =>
    new ConnectorError(
      refusal.code,
      refusal.message,
      refusal.retryAt === undefined ? undefined : Math.max(1, Math.ceil((refusal.retryAt - now) / 1000)),
    )

  return {
    check(source, keyPrint, symbol, now) {
      const forSource = bySource.get(source)
      if (applies(forSource, keyPrint, now)) throw asError(forSource, now)
      if (forSource) bySource.delete(source)
      if (symbol === undefined) return
      const forSymbol = bySymbol.get(symbolKey(source, symbol))
      if (applies(forSymbol, keyPrint, now)) throw asError(forSymbol, now)
    },

    remember(source, keyPrint, symbol, error, now) {
      if (!isConnectorError(error)) return
      const refusal = { code: error.code, message: error.message, keyPrint }
      switch (error.code) {
        case 'RATE_LIMITED': {
          const retryAt = now + (error.retryAfter ?? 60) * 1000
          bySource.set(source, { ...refusal, retryAt, until: Math.min(retryAt, now + MAX_RATE_LIMIT_PAUSE_MS) })
          return
        }
        case 'INVALID_KEY':
          bySource.set(source, { ...refusal, until: now + REFUSAL_PAUSE_MS })
          return
        case 'PLAN_LIMIT':
          // Plans cover some symbols and not others, so only this symbol waits.
          if (symbol !== undefined) bySymbol.set(symbolKey(source, symbol), { ...refusal, until: now + REFUSAL_PAUSE_MS })
          return
        default:
          return
      }
    },
  }
}

/**
 * A short fingerprint of a key, so a refusal is tied to the key without keeping a copy of it.
 * FNV-1a: not meant to hide anything, only to notice that the key changed.
 */
export function keyFingerprint(key: string | undefined): string {
  let hash = 0x811c9dc5
  for (const char of key ?? '') {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}
