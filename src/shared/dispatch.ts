import { customHistory } from './custom/history.js'
import type { CustomSource } from './custom/definition.js'
import { templateHost } from './custom/definition.js'
import { todayUtc } from './protocol/dates.js'
import { ConnectorError, isConnectorError } from './protocol/errors.js'
import { LIMITS, PROTOCOL_VERSION, PROVIDER_IDS } from './protocol/types.js'
import type { ConnectorErrorBody, ConnectorKind, ConnectorResponse, HelloResult, ProviderInfo, SourceId } from './protocol/types.js'
import { isProviderId, requestIdOf, validateRequest } from './protocol/validate.js'
import { createLimiter } from './providers/limiter.js'
import { ADAPTERS, MIN_GAP_MS, providerInfo } from './providers/registry.js'
import type { FetchLike, ProviderContext } from './providers/types.js'
import { sanitizeSearchResult } from './sanitize.js'

export interface DispatchDeps {
  connector: ConnectorKind
  version: string
  /** The user's key for a provider or a custom source, or undefined when none is set. */
  getKey(source: SourceId): string | undefined | Promise<string | undefined>
  fetch: FetchLike
  /** The custom sources the user defined in this connector, already checked. */
  customSources?: () => readonly CustomSource[] | Promise<readonly CustomSource[]>
  /**
   * Whether the connector may reach this origin (`https://host`). The extension asks the browser
   * for its granted host permissions; the bridge can reach anything and leaves this out.
   */
  canReach?: (origin: string) => boolean | Promise<boolean>
  /** Opens the connector's own settings. Left out by connectors that have none to open. */
  openSettings?: () => void | Promise<void>
  now?: () => Date
  timeoutMs?: number
}

/** Pause between two calls to the same custom source. */
const CUSTOM_MIN_GAP_MS = 500

const limiters = new Map<SourceId, ReturnType<typeof createLimiter>>()

function limiterFor(source: SourceId): ReturnType<typeof createLimiter> {
  let limiter = limiters.get(source)
  if (!limiter) {
    limiter = createLimiter(isProviderId(source) ? MIN_GAP_MS[source] : CUSTOM_MIN_GAP_MS)
    limiters.set(source, limiter)
  }
  return limiter
}

/** Never let a key reach the app, even inside a message: replace any copy of it. */
function scrub(body: ConnectorErrorBody, key: string | undefined): ConnectorErrorBody {
  if (!key || key.length < 4 || !body.message.includes(key)) return body
  return { ...body, message: body.message.split(key).join('***') }
}

async function customSourcesOf(deps: DispatchDeps): Promise<readonly CustomSource[]> {
  const sources = (await deps.customSources?.()) ?? []
  return sources.slice(0, LIMITS.customSources)
}

function customInfo(source: CustomSource): ProviderInfo {
  const info: ProviderInfo = {
    id: source.id,
    name: source.name,
    configured: true,
    custom: true,
    capabilities: { search: false, history: true },
  }
  if (source.symbolHint) info.symbolHint = source.symbolHint
  return info
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
        const builtIns = await Promise.all(PROVIDER_IDS.map(async (p) => providerInfo(p, Boolean((await deps.getKey(p))?.trim()))))
        const custom = (await customSourcesOf(deps)).map(customInfo)
        const result: HelloResult = { protocol: PROTOCOL_VERSION, connector: deps.connector, version: deps.version, providers: [...builtIns, ...custom] }
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
        if (!isProviderId(provider)) {
          const custom = (await customSourcesOf(deps)).find((s) => s.id === provider)
          if (custom) throw new ConnectorError('UNSUPPORTED_OPERATION', `${custom.name} has no search. Type the symbol instead.`)
          throw new ConnectorError('NOT_CONFIGURED', 'This connector has no source with that id.')
        }
        key = await builtInKey(provider, deps)
        const ctx = context(key, deps)
        const raw = await limiterFor(provider)(() => ADAPTERS[provider].search(query, ctx))
        const results = raw.map(sanitizeSearchResult).filter((r) => r !== undefined)
        return { id, ok: true, result: { results: results.slice(0, LIMITS.searchResults) } }
      }
      case 'history': {
        const { provider, symbol, from } = request.params
        const to = request.params.to ?? todayUtc(now())
        if (isProviderId(provider)) {
          key = await builtInKey(provider, deps)
          const ctx = context(key, deps)
          const result = await limiterFor(provider)(() => ADAPTERS[provider].history(symbol, from, to, ctx))
          return { id, ok: true, result }
        }
        const source = (await customSourcesOf(deps)).find((s) => s.id === provider)
        if (!source) throw new ConnectorError('NOT_CONFIGURED', 'This connector has no source with that id.')
        const host = templateHost(source.url) ?? ''
        if (deps.canReach && !(await deps.canReach(`https://${host}`))) {
          throw new ConnectorError(
            'NOT_CONFIGURED',
            `The browser has not let the connector reach ${host} for ${source.name}. Open the connector's settings and save the source again.`,
          )
        }
        key = (await deps.getKey(provider))?.trim() || undefined
        const result = await limiterFor(provider)(() =>
          customHistory(source, symbol, from, to, {
            fetch: deps.fetch,
            ...(key ? { key } : {}),
            ...(deps.now ? { now: deps.now } : {}),
            ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
          }),
        )
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

async function builtInKey(provider: keyof typeof ADAPTERS, deps: DispatchDeps): Promise<string> {
  const key = (await deps.getKey(provider))?.trim()
  if (!key) {
    throw new ConnectorError('NOT_CONFIGURED', `No ${ADAPTERS[provider].name} API key is set in this connector.`)
  }
  return key
}

function context(apiKey: string, deps: DispatchDeps): ProviderContext {
  const ctx: ProviderContext = { apiKey, fetch: deps.fetch }
  if (deps.now) ctx.now = deps.now
  if (deps.timeoutMs !== undefined) ctx.timeoutMs = deps.timeoutMs
  return ctx
}
