import { ConnectorError } from '../protocol/errors.js'

/** Calls waiting for one provider beyond which new ones are turned away. */
export const MAX_QUEUED = 20

/**
 * Runs one call at a time with at least `minGapMs` between the end of one and the start of the
 * next, so a burst from the app never trips a provider's per-second limit. When `maxQueued` calls
 * are already waiting, a new one is refused with RATE_LIMITED instead of piling up.
 */
export function createLimiter(minGapMs: number, sleep: (ms: number) => Promise<void> = defaultSleep, maxQueued = MAX_QUEUED) {
  let chain: Promise<unknown> = Promise.resolve()
  let lastEnd = 0
  let pending = 0
  return function run<T>(task: () => Promise<T>): Promise<T> {
    if (pending >= maxQueued) {
      return Promise.reject(new ConnectorError('RATE_LIMITED', 'Too many requests are waiting for this provider. Try again shortly.', 5))
    }
    pending++
    const result = chain.then(async () => {
      const wait = lastEnd + minGapMs - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        return await task()
      } finally {
        lastEnd = Date.now()
        pending--
      }
    })
    chain = result.catch(() => undefined)
    return result
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
