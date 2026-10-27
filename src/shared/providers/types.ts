import type { HistoryAnswer, ProviderId, SearchResult } from '../protocol/types.js'

/** The part of a fetch Response the adapters use. */
export interface HttpResponseLike {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  /** Read in chunks when present, so an oversized answer is cut off instead of buffered. */
  body?: ReadableStream<Uint8Array> | null
  text(): Promise<string>
}

/**
 * A fetch the caller passes in: global fetch in Node 22+ and in an extension service worker.
 * Requests never carry cookies (`credentials: 'omit'`) and never follow a redirect
 * (`redirect: 'error'`): a request goes to the address that was built, and nowhere else. Nothing is
 * kept in the HTTP cache (`cache: 'no-store'`), since an address can hold a key.
 */
export type FetchLike = (
  url: string,
  init: {
    method: 'GET'
    headers: Record<string, string>
    signal: AbortSignal
    redirect: 'error'
    credentials: 'omit'
    cache: 'no-store'
  },
) => Promise<HttpResponseLike>

export interface ProviderContext {
  apiKey: string
  fetch: FetchLike
  now?: () => Date
  /** How long one provider call may take. Defaults to 30 seconds. */
  timeoutMs?: number
}

export interface ProviderAdapter {
  id: ProviderId
  name: string
  capabilities: { search: boolean; history: boolean }
  search(query: string, ctx: ProviderContext): Promise<SearchResult[]>
  /** Daily closes from `from` to `to` (both YYYY-MM-DD, inclusive). */
  history(symbol: string, from: string, to: string, ctx: ProviderContext): Promise<HistoryAnswer>
}
