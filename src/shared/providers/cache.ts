/**
 * A Map that forgets its least recently used entry past `max`, so a long-running connector does
 * not grow without bound.
 */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>()

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }
}

/** Symbols whose currency each provider has told us. */
export const CURRENCY_CACHE_SIZE = 2000
