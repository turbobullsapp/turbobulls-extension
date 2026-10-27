import type { FetchLike } from '../providers/types.js'

export interface FakeRoute {
  /** Which request this answers. */
  match: (url: URL) => boolean
  status?: number
  /** Sent as JSON. */
  body?: unknown
  /** Sent as is, when the answer is not JSON. */
  text?: string
  /** Sent as a stream of these chunks instead of `body` or `text`. */
  chunks?: Uint8Array[]
  headers?: Record<string, string>
}

export interface RecordedCall {
  url: URL
  headers: Record<string, string>
  redirect: string
  credentials: string
}

/**
 * A fetch that answers from a list of routes and records every request it saw. Like a real fetch
 * with `redirect: 'error'`, it fails on a 3xx answer instead of following it.
 */
export function fakeFetch(routes: FakeRoute[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, headers: init.headers, redirect: init.redirect, credentials: init.credentials })
    const route = routes.find((r) => r.match(parsed))
    if (!route) throw new Error(`fake fetch has no route for ${parsed.origin}${parsed.pathname}`)
    const status = route.status ?? 200
    if (status >= 300 && status < 400 && init.redirect === 'error') throw new TypeError('fetch failed: redirect')
    const headers = Object.fromEntries(Object.entries(route.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    const chunks = route.chunks
    const text = route.text ?? (route.body === undefined ? '' : JSON.stringify(route.body))
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      body: chunks
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk)
              controller.close()
            },
          })
        : null,
      text: async () => text,
    }
  }
  return { fetch, calls }
}

export const path = (p: string) => (url: URL) => url.pathname === p
export const pathStarts = (p: string) => (url: URL) => url.pathname.startsWith(p)
export const query = (name: string, value: string) => (url: URL) => url.searchParams.get(name) === value
export const all =
  (...preds: Array<(url: URL) => boolean>) =>
  (url: URL) =>
    preds.every((p) => p(url))

/** Plainly fake, and long enough that a leak is easy to spot in any string. */
export const TEST_KEY = 'fake-key-for-tests-0000-not-real'
