import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogBatcher } from './batcher.js'
import type { LogBatcherOptions } from '../types.js'

type TestOptions = Omit<Partial<LogBatcherOptions<string>>, 'sendBatch'> & {
  sendBatch?: LogBatcherOptions<string>['sendBatch']
  // Holds the first send until `release()` is called.
  blockFirstSend?: boolean
  // Routes flushOnUnload() to its own recorder instead of falling back to sendBatch.
  separateUnload?: boolean
}

function setup({
  blockFirstSend,
  separateUnload,
  ...options
}: TestOptions = {}) {
  const batches: string[][] = []
  const unloadBatches: string[][] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const batcher = new LogBatcher<string>({
    ...options,
    sendBatch: async (items) => {
      batches.push([...items])
      if (blockFirstSend && batches.length === 1) await gate
      await options.sendBatch?.(items)
    },
    ...(separateUnload && {
      sendBatchOnUnload: async (items: readonly string[]) => {
        unloadBatches.push([...items])
      },
    }),
  })

  return { batcher, batches, unloadBatches, release }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('LogBatcher', () => {
  it('flushes at default threshold of 20 records', async () => {
    const { batcher, batches } = setup()
    const firstNineteen = Array.from({ length: 19 }, (_, index) =>
      batcher.add(`log-${index + 1}`),
    )

    expect(batches).toEqual([])

    const twentieth = batcher.add('log-20')
    await Promise.all([...firstNineteen, twentieth])

    expect(batches).toEqual([
      Array.from({ length: 20 }, (_, index) => `log-${index + 1}`),
    ])
  })

  it('starts default 5-second timer only when logs are queued', async () => {
    vi.useFakeTimers()
    const { batcher, batches } = setup()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(batches).toEqual([])

    const pending = batcher.add('waiting log')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(batches).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(batches).toEqual([['waiting log']])
  })

  it('uses configured batch size and timer delay', async () => {
    vi.useFakeTimers()
    const { batcher, batches } = setup({
      maxBatchSize: 10,
      scheduledDelayMs: 250,
    })
    const pending = batcher.add('custom delay')

    await vi.advanceTimersByTimeAsync(249)
    expect(batches).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect(batches).toEqual([['custom delay']])
  })

  it('caps batches and preserves order while a send is in flight', async () => {
    const { batcher, batches, release } = setup({
      maxBatchSize: 2,
      scheduledDelayMs: 60_000,
      blockFirstSend: true,
    })
    const firstBatch = [batcher.add('one'), batcher.add('two')]
    const queued = [
      batcher.add('three'),
      batcher.add('four'),
      batcher.add('five'),
    ]

    release()
    await Promise.all([...firstBatch, ...queued])

    expect(batches).toEqual([['one', 'two'], ['three', 'four'], ['five']])
  })

  it('rejects new entries when pending queue is full', async () => {
    const { batcher, release } = setup({
      maxBatchSize: 1,
      maxQueueSize: 1,
      blockFirstSend: true,
    })
    const inFlight = batcher.add('in flight')
    const queued = batcher.add('queued')

    await expect(batcher.add('rejected')).rejects.toThrow(
      'SomLogger batch queue is full.',
    )

    release()
    await Promise.all([inFlight, queued])
  })

  it('rejects entries in a failed batch and accepts later entries', async () => {
    let sendCount = 0
    const { batcher } = setup({
      maxBatchSize: 1,
      sendBatch: async () => {
        if (sendCount++ === 0) throw new Error('collector unavailable')
      },
    })

    await expect(batcher.add('failed')).rejects.toThrow('collector unavailable')
    await expect(batcher.add('recovered')).resolves.toBeUndefined()
  })

  it('flushes on demand and during shutdown', async () => {
    const { batcher, batches } = setup({ scheduledDelayMs: 60_000 })
    const manualFlush = batcher.add('manual')

    await batcher.flush()
    await manualFlush

    const shutdownFlush = batcher.add('shutdown')
    await batcher.shutdown()
    await shutdownFlush

    expect(batches).toEqual([['manual'], ['shutdown']])
    await expect(batcher.add('after shutdown')).rejects.toThrow(
      'LogBatcher has been shut down.',
    )
  })
})

describe('overflowStrategy', () => {
  it('drops the oldest queued record and counts it', async () => {
    const onDropped = vi.fn()
    const { batcher, batches, release } = setup({
      maxBatchSize: 1,
      maxQueueSize: 2,
      overflowStrategy: 'drop-oldest',
      onDropped,
      blockFirstSend: true,
    })
    const inFlight = batcher.add('in flight')
    const oldest = batcher.add('oldest')
    const kept = batcher.add('kept')
    const newest = batcher.add('newest')

    await expect(oldest).rejects.toThrow(
      'SomLogger batch queue is full; oldest record dropped.',
    )
    release()
    await Promise.all([inFlight, kept, newest])

    expect(batches).toEqual([['in flight'], ['kept'], ['newest']])
    expect(batcher.droppedCount).toBe(1)
    expect(onDropped).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('counts records rejected by the default strategy', async () => {
    const onDropped = vi.fn()
    const { batcher, release } = setup({
      maxBatchSize: 1,
      maxQueueSize: 1,
      onDropped,
      blockFirstSend: true,
    })
    const inFlight = batcher.add('in flight')
    const queued = batcher.add('queued')

    await expect(batcher.add('rejected')).rejects.toThrow(
      'SomLogger batch queue is full.',
    )
    release()
    await Promise.all([inFlight, queued])

    expect(batcher.droppedCount).toBe(1)
    expect(onDropped).toHaveBeenCalledWith(1)
  })
})

describe('flushOnUnload', () => {
  it('sends pending items immediately even while a flush is in flight', async () => {
    const { batcher, batches, unloadBatches, release } = setup({
      maxBatchSize: 2,
      scheduledDelayMs: 60_000,
      blockFirstSend: true,
      separateUnload: true,
    })
    const first = batcher.add('first')
    void batcher.flush()
    const pending = [batcher.add('a'), batcher.add('b'), batcher.add('c')]

    const unload = batcher.flushOnUnload()

    expect(unloadBatches).toEqual([['a', 'b'], ['c']])
    await unload
    await Promise.all(pending)

    release()
    await first
    expect(batches).toEqual([['first']])
  })

  it('falls back to sendBatch and rejects affected items on failure', async () => {
    const { batcher } = setup({
      scheduledDelayMs: 60_000,
      sendBatch: async () => {
        throw new Error('unload send failed')
      },
    })
    const pending = batcher.add('lost')

    await expect(batcher.flushOnUnload()).rejects.toThrow('unload send failed')
    await expect(pending).rejects.toThrow('unload send failed')
  })

  it('is a no-op when nothing is pending', async () => {
    const { batcher, unloadBatches } = setup({ separateUnload: true })

    await expect(batcher.flushOnUnload()).resolves.toBeUndefined()
    expect(unloadBatches).toEqual([])
  })
})
