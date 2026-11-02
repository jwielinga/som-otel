import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SomDiagnosticEvent } from '../types.js'
import { stubPage } from '../test-support/page.js'
import { setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const slowBatch = { maxBatchSize: 10, scheduledDelayMs: 60_000 }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('span batching', () => {
  it('sends spans in one request once the batch is full', async () => {
    const { som, collector } = setup({
      batch: { maxBatchSize: 3, scheduledDelayMs: 60_000 },
    })

    for (const name of ['a', 'b', 'c']) som.tracer.startSpan(name).end()
    await som.flush()

    expect(collector.requests).toHaveLength(1)
    expect(collector.spans.map((span) => span.name)).toEqual(['a', 'b', 'c'])
  })

  it('sends a partial batch when the timer fires', async () => {
    vi.useFakeTimers()
    const { som, collector } = setup({
      batch: { maxBatchSize: 10, scheduledDelayMs: 1_000 },
    })

    som.tracer.startSpan('a').end()
    await vi.advanceTimersByTimeAsync(999)
    expect(collector.requests).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(collector.spans.map((span) => span.name)).toEqual(['a'])
    await som.flush()
  })

  it('keeps logs and spans in separate requests', async () => {
    const { som, collector } = setup({ batch: slowBatch })

    void som.logger.info('log')
    som.tracer.startSpan('span').end()
    await som.flush()

    expect(collector.requests).toHaveLength(2)
    expect(collector.requests.map((request) => request.records.length)).toEqual(
      [1, 0],
    )
    expect(collector.requests.map((request) => request.spans.length)).toEqual([
      0, 1,
    ])
  })
})

describe('span queue overflow', () => {
  it('rejects the new span by default and counts it', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      batch: { maxBatchSize: 1, maxQueueSize: 1 },
      onDiagnostic: (event) => events.push(event),
    })
    const release = collector.hold()

    for (const name of ['in flight', 'queued', 'rejected']) {
      som.tracer.startSpan(name).end()
    }
    release()
    await som.flush()

    expect(collector.spans.map((span) => span.name)).toEqual([
      'in flight',
      'queued',
    ])
    expect(som.tracer.droppedSpanCount).toBe(1)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'records-dropped', totalDropped: 1 }),
    )
  })

  it('evicts the oldest queued span with drop-oldest', async () => {
    const { som, collector } = setup({
      batch: {
        maxBatchSize: 1,
        maxQueueSize: 1,
        overflowStrategy: 'drop-oldest',
      },
    })
    const release = collector.hold()

    for (const name of ['in flight', 'dropped', 'kept']) {
      som.tracer.startSpan(name).end()
    }
    release()
    await som.flush()

    expect(collector.spans.map((span) => span.name)).toEqual([
      'in flight',
      'kept',
    ])
    expect(som.tracer.droppedSpanCount).toBe(1)
  })
})

describe('shutdown', () => {
  it('delivers pending logs and spans, then ignores new spans', async () => {
    const { som, collector } = setup({ batch: slowBatch })

    const logged = som.logger.info('pending log')
    som.tracer.startSpan('pending span').end()
    await som.shutdown()
    await logged

    expect(collector.bodies).toEqual(['pending log'])
    expect(collector.spans.map((span) => span.name)).toEqual(['pending span'])

    const late = som.tracer.startSpan('late')
    expect(late.isRecording()).toBe(false)
    late.end()
    await som.flush()
    expect(collector.spans).toHaveLength(1)
    await expect(som.logger.info('late')).rejects.toThrow('shut down')
  })

  it('shuts the tracer down on its own', async () => {
    const { som, collector } = setup({ batch: slowBatch })

    som.tracer.startSpan('pending').end()
    await som.tracer.shutdown()

    expect(collector.spans.map((span) => span.name)).toEqual(['pending'])
    expect(som.tracer.startSpan('late').isRecording()).toBe(false)
    const stillOpen = som.logger.info('still open')
    await som.logger.flush()
    await expect(stillOpen).resolves.toBeUndefined()
  })
})

describe('page hide flush', () => {
  it('sends queued logs and spans synchronously with keepalive', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const { som, collector } = setup({ batch: slowBatch })

    const logged = som.logger.info('last words')
    som.tracer.startSpan('last span').end()
    page.pagehide()

    expect(collector.requests).toHaveLength(2)
    expect(collector.requests.every((request) => request.keepalive)).toBe(true)
    expect(collector.requests.map((request) => request.url).sort()).toEqual([
      'https://collector.example/v1/logs',
      'https://collector.example/v1/traces',
    ])
    await logged
    await som.flush()
    expect(collector.spans.map((span) => span.name)).toEqual(['last span'])
  })

  it('flushes spans when the page becomes hidden', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const { som, collector } = setup({ batch: slowBatch })

    som.tracer.startSpan('tab switch').end()
    page.setVisibility('visible')
    expect(collector.requests).toHaveLength(0)

    page.setVisibility('hidden')
    expect(collector.spans.map((span) => span.name)).toEqual(['tab switch'])
    await som.flush()
  })

  it('uses one set of page listeners and removes it on som.shutdown', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const { som } = setup({ batch: slowBatch })
    expect(page.listenerCount()).toBe(2)

    await som.tracer.shutdown()
    expect(page.listenerCount()).toBe(2)

    await som.shutdown()
    expect(page.listenerCount()).toBe(0)
  })
})
