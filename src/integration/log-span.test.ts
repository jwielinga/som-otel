import { describe, expect, it } from 'vitest'
import { setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const providerContext = {
  traceId: 'c'.repeat(32),
  spanId: 'd'.repeat(16),
  traceFlags: 1,
}

describe('log to span correlation', () => {
  it('links a log to a span through the span option', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('checkout')
    await som.logger.info('payment failed', { orderId: 42 }, { span })
    span.end()
    await som.flush()

    const { traceId, spanId } = span.spanContext()
    expect(collector.records[0]).toMatchObject({ traceId, spanId, flags: 1 })
    expect(collector.spans[0]).toMatchObject({ traceId, spanId })
  })

  it('works from every severity helper and keeps the event name', async () => {
    const { som, collector } = setup()
    const span = som.tracer.startSpan('x')

    await som.logger.trace('a', {}, { span })
    await som.logger.debug('b', {}, { span })
    await som.logger.warn('c', {}, { span })
    await som.logger.error('d', {}, { span, eventName: 'checkout.failed' })

    const { spanId } = span.spanContext()
    expect(collector.records.map((record) => record.spanId)).toEqual([
      spanId,
      spanId,
      spanId,
      spanId,
    ])
    expect(collector.records[3]?.eventName).toBe('checkout.failed')
  })

  it('carries the sampling flag of an unsampled span', async () => {
    const { som, collector } = setup()

    const unsampled = som.tracer.startSpan('x', {
      parent: {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 0,
      },
    })
    await som.logger.info('hello', {}, { span: unsampled })

    expect(collector.records[0]).toMatchObject({
      traceId: 'a'.repeat(32),
      spanId: unsampled.spanContext().spanId,
      flags: 0,
    })
  })

  it('prefers the span over the traceContext provider', async () => {
    const { som, collector } = setup({ traceContext: () => providerContext })

    const span = som.tracer.startSpan('x')
    await som.logger.info('with span', {}, { span })
    await som.logger.info('without span')

    expect(collector.records[0]?.spanId).toBe(span.spanContext().spanId)
    expect(collector.records[1]).toMatchObject({
      traceId: providerContext.traceId,
      spanId: providerContext.spanId,
    })
  })

  it('still accepts explicit trace fields', async () => {
    const { som, collector } = setup()

    await som.logger.info('x', {}, providerContext)

    expect(collector.records[0]).toMatchObject({
      traceId: providerContext.traceId,
      spanId: providerContext.spanId,
      flags: 1,
    })
  })

  it('rejects a span together with explicit trace fields at compile time', async () => {
    const { som } = setup()
    const span = som.tracer.startSpan('x')

    // @ts-expect-error span and explicit trace fields are mutually exclusive
    await som.logger.info('x', {}, { span, ...providerContext })
  })
})
