import { collectFailures, throwFailures } from '../utils/failures.js'
import type { LogBatcherOptions, PendingItem } from '../types.js'
import { SIGNAL_NAMES } from '../core/core.constants.js'
import {
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_SCHEDULED_DELAY_MS,
} from './transport.constants.js'

export class LogBatcher<T> {
  private readonly maxBatchSize: number
  private readonly maxQueueSize: number
  private readonly flushThreshold: number
  private readonly scheduledDelayMs: number
  private readonly overflowStrategy: 'reject-new' | 'drop-oldest'
  private readonly sendBatch: LogBatcherOptions<T>['sendBatch']
  private readonly sendBatchOnUnload: LogBatcherOptions<T>['sendBatch']
  private readonly onDropped: LogBatcherOptions<T>['onDropped']
  private readonly owner: string
  private readonly aggregateMessage: string
  private readonly pendingItems: PendingItem<T>[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private activeFlush: Promise<void> | undefined
  private isShutdown = false
  private totalDropped = 0

  constructor(options: LogBatcherOptions<T>) {
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE
    this.flushThreshold = Math.min(this.maxBatchSize, this.maxQueueSize)
    this.scheduledDelayMs =
      options.scheduledDelayMs ?? DEFAULT_SCHEDULED_DELAY_MS
    this.overflowStrategy = options.overflowStrategy ?? 'reject-new'
    this.sendBatch = options.sendBatch
    this.sendBatchOnUnload = options.sendBatchOnUnload ?? options.sendBatch
    this.onDropped = options.onDropped
    const { owner, noun } = SIGNAL_NAMES[options.signal ?? 'logs']
    this.owner = owner
    this.aggregateMessage = `Multiple OTLP ${noun} batches failed.`
  }

  get droppedCount(): number {
    return this.totalDropped
  }

  add(item: T): Promise<void> {
    if (this.isShutdown) {
      return Promise.reject(new Error('LogBatcher has been shut down.'))
    }
    if (this.pendingItems.length >= this.maxQueueSize) {
      if (this.overflowStrategy === 'reject-new') {
        this.recordDrop()
        return Promise.reject(new Error(`${this.owner} batch queue is full.`))
      }
      this.dropOldest()
    }

    const itemPromise = new Promise<void>((resolve, reject) => {
      this.pendingItems.push({ item, resolve, reject })
    })

    if (this.pendingItems.length >= this.flushThreshold) {
      this.flushInBackground()
    } else {
      this.scheduleFlush()
    }

    return itemPromise
  }

  flush(): Promise<void> {
    this.clearFlushTimer()

    if (this.activeFlush) return this.waitForActiveFlush(this.activeFlush)
    if (this.pendingItems.length === 0) return Promise.resolve()

    return this.startFlush()
  }

  private waitForActiveFlush(activeFlush: Promise<void>): Promise<void> {
    return activeFlush.then(
      () => this.flushPendingItems(),
      (error: unknown) => this.flushAfterFailure(error),
    )
  }

  private async flushPendingItems(): Promise<void> {
    if (this.pendingItems.length > 0) await this.flush()
  }

  private async flushAfterFailure(error: unknown): Promise<void> {
    if (this.pendingItems.length === 0) throw error

    try {
      await this.flush()
    } catch (nextError) {
      throw new AggregateError([error, nextError], this.aggregateMessage, {
        cause: nextError,
      })
    }

    throw error
  }

  private startFlush(): Promise<void> {
    const activeFlush = this.drainPendingItems().finally(() => {
      this.finishFlush(activeFlush)
    })
    this.activeFlush = activeFlush
    return activeFlush
  }

  private finishFlush(activeFlush: Promise<void>): void {
    if (this.activeFlush === activeFlush) this.activeFlush = undefined

    if (this.pendingItems.length >= this.flushThreshold) {
      this.flushInBackground()
    } else if (this.pendingItems.length > 0) {
      this.scheduleFlush()
    }
  }

  // Sends every pending item immediately, without waiting for an in-flight flush.
  flushOnUnload(): Promise<void> {
    this.clearFlushTimer()

    const sends: Promise<void>[] = []
    while (this.pendingItems.length > 0) {
      const batch = this.pendingItems.splice(0, this.maxBatchSize)
      sends.push(this.sendAndSettle(batch, this.sendBatchOnUnload))
    }

    return Promise.allSettled(sends).then((results) => {
      throwFailures(collectFailures(results), this.aggregateMessage)
    })
  }

  shutdown(): Promise<void> {
    this.isShutdown = true
    this.clearFlushTimer()
    return this.flush()
  }

  private dropOldest(): void {
    const oldest = this.pendingItems.shift()
    this.recordDrop()
    oldest?.reject(
      new Error(`${this.owner} batch queue is full; oldest record dropped.`),
    )
  }

  private recordDrop(): void {
    this.totalDropped++
    this.onDropped?.(this.totalDropped)
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flushInBackground()
    }, this.scheduledDelayMs)
  }

  // Failures already reject each affected item's own promise.
  private flushInBackground(): void {
    void this.flush().catch(() => undefined)
  }

  private clearFlushTimer(): void {
    if (this.flushTimer === undefined) return
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private async sendAndSettle(
    batch: PendingItem<T>[],
    send: (items: readonly T[]) => Promise<void>,
  ): Promise<void> {
    try {
      await send(batch.map(({ item }) => item))
    } catch (error) {
      for (const pending of batch) pending.reject(error)
      throw error
    }
    for (const pending of batch) pending.resolve()
  }

  private async drainPendingItems(): Promise<void> {
    const failures: unknown[] = []

    while (this.pendingItems.length > 0) {
      const batch = this.pendingItems.splice(0, this.maxBatchSize)
      try {
        await this.sendAndSettle(batch, this.sendBatch)
      } catch (error) {
        failures.push(error)
      }
    }

    throwFailures(failures, this.aggregateMessage)
  }
}
