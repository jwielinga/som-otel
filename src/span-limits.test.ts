import { describe, expect, it } from 'vitest'
import { attributeOf, setupSom as setup } from './test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const traceId = '5b8efff798038103d269b633813fc60c'
const spanId = 'eee19b7ec3c1b174'

describe('span links', () => {
  it('records links from start options and addLink', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x', {
      links: [
        {
          context: { traceId, spanId, traceFlags: 1 },
          attributes: { reason: 'batch' },
        },
      ],
    })
    span.addLink({
      context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    })
    span.end()
    await som.flush()

    const links = collector.spans[0]?.links
    expect(links).toHaveLength(2)
    expect(links?.[0]).toMatchObject({
      traceId,
      spanId,
      flags: 1,
      attributes: [{ key: 'reason', value: { stringValue: 'batch' } }],
    })
    expect(links?.[1]).toMatchObject({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    })
    expect(links?.[1]).not.toHaveProperty('flags')
  })

  it('links to another span through its span context', async () => {
    const { som, collector } = setup()

    const producer = som.tracer.startSpan('produce')
    const consumer = som.tracer.startSpan('consume', {
      kind: 'consumer',
      links: [{ context: producer.spanContext() }],
    })
    consumer.end()
    await som.flush()

    expect(collector.spans[0]?.links?.[0]).toMatchObject({
      traceId: producer.spanContext().traceId,
      spanId: producer.spanContext().spanId,
    })
  })
})

describe('span limits', () => {
  it('drops attributes beyond attributeCountLimit and counts them', async () => {
    const { som, collector } = setup({ limits: { attributeCountLimit: 2 } })

    const span = som.tracer.startSpan('x')
    span.setAttributes({ a: 1, b: 2, c: 3 })
    span.setAttribute('a', 10)
    span.end()
    await som.flush()

    const [recorded] = collector.spans
    expect(recorded?.attributes?.map((entry) => entry.key)).toEqual(['a', 'b'])
    expect(attributeOf(recorded?.attributes, 'a')).toEqual({ intValue: '10' })
    expect(recorded?.droppedAttributesCount).toBe(1)
  })

  it('defaults to 128 attributes, events, and links', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    for (let index = 0; index < 130; index++) {
      span.setAttribute(`attr.${index}`, index)
      span.addEvent(`event.${index}`)
      span.addLink({ context: { traceId, spanId } })
    }
    span.end()
    await som.flush()

    const [recorded] = collector.spans
    expect(recorded?.attributes).toHaveLength(128)
    expect(recorded?.droppedAttributesCount).toBe(2)
    expect(recorded?.events).toHaveLength(128)
    expect(recorded?.events?.[127]?.name).toBe('event.127')
    expect(recorded?.droppedEventsCount).toBe(2)
    expect(recorded?.links).toHaveLength(128)
    expect(recorded?.droppedLinksCount).toBe(2)
  })

  it('applies eventCountLimit and linkCountLimit', async () => {
    const { som, collector } = setup({
      limits: { eventCountLimit: 1, linkCountLimit: 1 },
    })

    const span = som.tracer.startSpan('x')
    span.addEvent('first')
    span.addEvent('second')
    span.addLink({ context: { traceId, spanId } })
    span.addLink({ context: { traceId, spanId } })
    span.end()
    await som.flush()

    const [recorded] = collector.spans
    expect(recorded?.events?.map((event) => event.name)).toEqual(['first'])
    expect(recorded?.droppedEventsCount).toBe(1)
    expect(recorded?.links).toHaveLength(1)
    expect(recorded?.droppedLinksCount).toBe(1)
  })

  it('omits dropped counts when nothing was dropped', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    span.setAttribute('a', 1)
    span.addEvent('e')
    span.end()
    await som.flush()

    expect(collector.spans[0]).not.toHaveProperty('droppedAttributesCount')
    expect(collector.spans[0]).not.toHaveProperty('droppedEventsCount')
    expect(collector.spans[0]).not.toHaveProperty('droppedLinksCount')
  })

  it('applies attributeCountLimit to each event and link', async () => {
    const { som, collector } = setup({ limits: { attributeCountLimit: 1 } })

    const span = som.tracer.startSpan('x')
    span.addEvent('e', { a: 1, b: 2 })
    span.addLink({ context: { traceId, spanId }, attributes: { a: 1, b: 2 } })
    span.end()
    await som.flush()

    const [recorded] = collector.spans
    expect(recorded?.events?.[0]?.attributes).toHaveLength(1)
    expect(recorded?.events?.[0]?.droppedAttributesCount).toBe(1)
    expect(recorded?.links?.[0]?.attributes).toHaveLength(1)
    expect(recorded?.links?.[0]?.droppedAttributesCount).toBe(1)
  })

  it('truncates string values to attributeValueLengthLimit everywhere', async () => {
    const { som, collector } = setup({
      limits: { attributeValueLengthLimit: 3 },
    })

    const span = som.tracer.startSpan('x', { attributes: { a: 'abcdef' } })
    span.addEvent('e', { b: 'abcdef' })
    span.addLink({ context: { traceId, spanId }, attributes: { c: 'abcdef' } })
    span.end()
    await som.flush()

    const [recorded] = collector.spans
    expect(attributeOf(recorded?.attributes, 'a')).toEqual({
      stringValue: 'abc',
    })
    expect(attributeOf(recorded?.events?.[0]?.attributes, 'b')).toEqual({
      stringValue: 'abc',
    })
    expect(attributeOf(recorded?.links?.[0]?.attributes, 'c')).toEqual({
      stringValue: 'abc',
    })
  })
})
