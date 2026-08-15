interface CacheEntry<T> {
  value: T
  expiresAt: number | undefined
}

export class LruTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    this.entries.delete(key)
    this.entries.set(key, {
      value,
      expiresAt: this.ttlMs === 0 ? undefined : this.now() + this.ttlMs,
    })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}
