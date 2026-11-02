// A list that stops growing at its limit and counts what it turned away.
export class CappedList<T> {
  readonly items: T[] = []
  droppedCount = 0
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  add(item: T): void {
    if (this.items.length >= this.limit) {
      this.droppedCount++
    } else {
      this.items.push(item)
    }
  }
}

// A map that stops accepting new keys at its limit; existing keys can still be updated.
export class CappedMap<V> {
  readonly entries = new Map<string, V>()
  droppedCount = 0
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  set(key: string, value: V): void {
    if (!this.entries.has(key) && this.entries.size >= this.limit) {
      this.droppedCount++
    } else {
      this.entries.set(key, value)
    }
  }
}
