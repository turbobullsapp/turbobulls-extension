import { todayUtc } from './protocol/dates.js'
import { ConnectorError, isConnectorError } from './protocol/errors.js'
import { PROTOCOL_VERSION, PROVIDER_IDS, LIMITS } from './protocol/types.js'
import type { ConnectorErrorBody, ConnectorKind, ConnectorResponse, HelloResult, ProviderId } from './protocol/types.js'
import { requestIdOf, validateRequest } from './protocol/validate.js'
import { createLimiter } from './providers/limiter.js'
import { ADAPTERS, MIN_GAP_MS, providerInfo } from './providers/registry.js'
import type { FetchLike, ProviderContext } from './providers/types.js'
import { sanitizeSearchResult } from './sanitize.js'

export interface DispatchDeps {
  connector: ConnectorKind
  version: string
  /** The user's key for a provider, or undefined when none is set. */
  getKey(provider: ProviderId): string | undefined | Promise<string | undefined>
  fetch: FetchLike
  /** Opens the connector's own settings. Left out by connectors that have none to open. */
  openSettings?: () => void | Promise<void>
  now?: () => Date
  timeoutMs?: number
}

const limiters = new Map<ProviderId, ReturnType<typeof createLimiter>>()

function limiterFor(provider: ProviderId): ReturnType<typeof createLimiter> {
  let limiter = limiters.get(provider)
  if (!limiter) {
    limiter = createLimiter(MIN_GAP_MS[provider])
    limiters.set(provider, limiter)
  }
  return limiter
}

/** Never let a key reach the app, even inside a message: replace any copy of it. */
function scrub(body: ConnectorErrorBody, key: string | undefined): ConnectorErrorBody {
  if (!key || key.length < 4 || !body.message.includes(key)) return body
  return { ...body, message: body.message.split(key).join('***') }
}

async function keyFor(provider: ProviderId, deps: DispatchDeps): Promise<string> {
  const key = (await deps.getKey(provider))?.trim()
  if (!key) {
    throw new ConnectorError('NOT_CONFIGURED', `No ${ADAPTERS[provider].name} API key is set in this connector.`)
  }
  return key
}

/**
 * Answer one request from the app. Never throws: every failure becomes `{ ok: false, error }`,
 * and an unexpected failure is reported without its details, which could hold provider text.
 */
export async function dispatch(input: unknown, deps: DispatchDeps): Promise<ConnectorResponse> {
  const id = requestIdOf(input)
  const now = deps.now ?? (() => new Date())
  let key: string | undefined
  try {
    const request = validateRequest(input, now())
    switch (request.op) {
      case 'hello': {
        const providers = await Promise.all(
          PROVIDER_IDS.map(async (p) => providerInfo(p, Boolean((await deps.getKey(p))?.trim()))),
        )
        const result: HelloResult = { protocol: PROTOCOL_VERSION, connector: deps.connector, version: deps.version, providers }
        return { id, ok: true, result }
      }
      case 'openSettings': {
        if (!deps.openSettings) {
          throw new ConnectorError('UNSUPPORTED_OPERATION', 'This connector has no settings page to open.')
        }
        await deps.openSettings()
        return { id, ok: true, result: { opened: true } }
      }
      case 'search': {
        const { provider, query } = request.params
        key = await keyFor(provider, deps)
        const ctx = context(key, deps)
        const raw = await limiterFor(provider)(() => ADAPTERS[provider].search(query, ctx))
        const results = raw.map(sanitizeSearchResult).filter((r) => r !== undefined)
        return { id, ok: true, result: { results: results.slice(0, LIMITS.searchResults) } }
      }
      case 'history': {
        const { provider, symbol, from } = request.params
        const to = request.params.to ?? todayUtc(now())
        key = await keyFor(provider, deps)
        const ctx = context(key, deps)
        const result = await limiterFor(provider)(() => ADAPTERS[provider].history(symbol, from, to, ctx))
        return { id, ok: true, result }
      }
    }
  } catch (e) {
    const body: ConnectorErrorBody = isConnectorError(e)
      ? e.toBody()
      : { code: 'PROVIDER_ERROR', message: 'Something went wrong in the connector.' }
    return { id, ok: false, error: scrub(body, key) }
  }
}

function context(apiKey: string, deps: DispatchDeps): ProviderContext {
  const ctx: ProviderContext = { apiKey, fetch: deps.fetch }
  if (deps.now) ctx.now = deps.now
  if (deps.timeoutMs !== undefined) ctx.timeoutMs = deps.timeoutMs
  return ctx
}
