import { describe, expect, it } from 'vitest'
import { setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const traceId = '5b8efff798038103d269b633813fc60c'
const spanId = 'eee19b7ec3c1b174'

describe('span parenting', () => {
  it('continues the trace of a parent span', async () => {
    const { som, collector } = setup()

    const parent = som.tracer.startSpan('parent')
    const child = som.tracer.startSpan('child', { parent })
    child.end()
    parent.end()
    await som.flush()

    const [childSpan, parentSpan] = collector.spans
    expect(childSpan?.name).toBe('child')
    expect(childSpan?.traceId).toBe(parentSpan?.traceId)
    expect(childSpan?.parentSpanId).toBe(parentSpan?.spanId)
    expect(childSpan?.spanId).not.toBe(parentSpan?.spanId)
    expect(parentSpan).not.toHaveProperty('parentSpanId')
  })

  it('continues the trace of a span context', async () => {
    const { som, collector } = setup()

    som.tracer
      .startSpan('child', { parent: { traceId, spanId, traceFlags: 1 } })
      .end()
    await som.flush()

    expect(collector.spans[0]).toMatchObject({
      traceId,
      parentSpanId: spanId,
      flags: 1,
    })
  })

  it('treats a parent without trace flags as sampled', async () => {
    const { som, collector } = setup()

    som.tracer.startSpan('child', { parent: { traceId, spanId } }).end()
    await som.flush()

    expect(collector.spans[0]).toMatchObject({ traceId, flags: 1 })
  })

  it('gives separate root spans separate traces', async () => {
    const { som, collector } = setup()

    som.tracer.startSpan('a').end()
    som.tracer.startSpan('b').end()
    await som.flush()

    expect(collector.spans[0]?.traceId).not.toBe(collector.spans[1]?.traceId)
  })
})

describe('sampling', () => {
  it('does not record or export a span whose parent is not sampled', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('child', {
      parent: { traceId, spanId, traceFlags: 0 },
      attributes: { a: 1 },
    })
    span.setAttribute('b', 2).addEvent('e').setStatus({ code: 'error' })
    span.end()
    await som.flush()

    expect(span.isRecording()).toBe(false)
    expect(collector.requests).toHaveLength(0)
  })

  it('still propagates the trace through a non-recording span', async () => {
    const { som, collector } = setup()

    const unsampled = som.tracer.startSpan('skipped', {
      parent: { traceId, spanId, traceFlags: 0 },
    })
    const context = unsampled.spanContext()
    const grandchild = som.tracer.startSpan('grandchild', {
      parent: unsampled,
    })
    grandchild.end()
    await som.flush()

    expect(context.traceId).toBe(traceId)
    expect(context.spanId).not.toBe(spanId)
    expect(context.traceFlags).toBe(0)
    expect(grandchild.spanContext()).toMatchObject({
      traceId,
      traceFlags: 0,
    })
    expect(collector.requests).toHaveLength(0)
  })

  it('reports a sampled span as recording until it ends', async () => {
    const { som } = setup()

    const span = som.tracer.startSpan('x')
    expect(span.isRecording()).toBe(true)
    expect(span.spanContext().traceFlags).toBe(1)
    span.end()
    expect(span.isRecording()).toBe(false)
    await som.flush()
  })
})
