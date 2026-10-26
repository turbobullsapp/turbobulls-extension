/**
 * Runs one call at a time with at least `minGapMs` between the end of one and the start of the
 * next, so a burst from the app never trips a provider's per-second limit.
 */
export function createLimiter(minGapMs: number, sleep: (ms: number) => Promise<void> = defaultSleep) {
  let chain: Promise<unknown> = Promise.resolve()
  let lastEnd = 0
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(async () => {
      const wait = lastEnd + minGapMs - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        return await task()
      } finally {
        lastEnd = Date.now()
      }
    })
    chain = result.catch(() => undefined)
    return result
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
