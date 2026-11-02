import { describe, expect, it } from 'vitest'
import { OTelSpanKind, OTelStatusCode } from '../otlp/otlp.constants.js'
import type { SomDiagnosticEvent } from '../types.js'
import { attributeOf, setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const start = new Date('2026-01-01T00:00:00Z')
const startNano = '1767225600000000000'

describe('span timing and kind', () => {
  it('uses the supplied kind, start time, and end time', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('GET /cart', {
      kind: 'client',
      startTime: start,
    })
    span.end(1767225600500)
    await som.flush()

    expect(collector.spans[0]).toMatchObject({
      kind: OTelSpanKind.CLIENT,
      startTimeUnixNano: startNano,
      endTimeUnixNano: '1767225600500000000',
    })
  })

  it.each([
    ['internal', OTelSpanKind.INTERNAL],
    ['server', OTelSpanKind.SERVER],
    ['client', OTelSpanKind.CLIENT],
    ['producer', OTelSpanKind.PRODUCER],
    ['consumer', OTelSpanKind.CONSUMER],
  ] as const)('maps kind %s', async (kind, expected) => {
    const { som, collector } = setup()

    som.tracer.startSpan('x', { kind }).end()
    await som.flush()

    expect(collector.spans[0]?.kind).toBe(expected)
  })

  it('accepts a bigint as unix nanoseconds', async () => {
    const { som, collector } = setup()

    som.tracer
      .startSpan('x', { startTime: 1767225600123456789n })
      .end(1767225600123456790n)
    await som.flush()

    expect(collector.spans[0]).toMatchObject({
      startTimeUnixNano: '1767225600123456789',
      endTimeUnixNano: '1767225600123456790',
    })
  })
})

describe('span attributes', () => {
  it('merges start options, setAttribute, and setAttributes; later values win', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x', {
      attributes: { 'http.request.method': 'GET', retries: 0 },
    })
    span.setAttribute('http.response.status_code', 200)
    span.setAttributes({ retries: 2, 'url.path': '/cart', ok: true })
    span.end()
    await som.flush()

    const attributes = collector.spans[0]?.attributes
    expect(attributes?.map((entry) => entry.key)).toEqual([
      'http.request.method',
      'retries',
      'http.response.status_code',
      'url.path',
      'ok',
    ])
    expect(attributeOf(attributes, 'retries')).toEqual({ intValue: '2' })
    expect(attributeOf(attributes, 'ok')).toEqual({ boolValue: true })
    expect(attributeOf(attributes, 'url.path')).toEqual({
      stringValue: '/cart',
    })
  })

  it('omits attributes when none were set', async () => {
    const { som, collector } = setup()

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.spans[0]).not.toHaveProperty('attributes')
    expect(collector.spans[0]).not.toHaveProperty('events')
    expect(collector.spans[0]).not.toHaveProperty('status')
  })
})

describe('span events', () => {
  it('records events with attributes and timestamps in order', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x', { startTime: start })
    span.addEvent('cache.miss', { key: 'cart-42' }, 1767225600250)
    span.addEvent('retry')
    span.end()
    await som.flush()

    const events = collector.spans[0]?.events
    expect(events).toHaveLength(2)
    expect(events?.[0]).toMatchObject({
      name: 'cache.miss',
      timeUnixNano: '1767225600250000000',
      attributes: [{ key: 'key', value: { stringValue: 'cart-42' } }],
    })
    expect(events?.[1]?.name).toBe('retry')
    expect(events?.[1]?.timeUnixNano).toMatch(/^\d{19}$/)
  })

  it('records an exception event following the semantic conventions', async () => {
    const { som, collector } = setup()
    const error = new TypeError('bad cart')

    const span = som.tracer.startSpan('x')
    span.recordException(error, { 'exception.escaped': true })
    span.end()
    await som.flush()

    const [event] = collector.spans[0]?.events ?? []
    expect(event?.name).toBe('exception')
    expect(attributeOf(event?.attributes, 'exception.type')).toEqual({
      stringValue: 'TypeError',
    })
    expect(attributeOf(event?.attributes, 'exception.message')).toEqual({
      stringValue: 'bad cart',
    })
    expect(
      attributeOf(event?.attributes, 'exception.stacktrace'),
    ).toMatchObject({ stringValue: expect.stringContaining('bad cart') })
    expect(attributeOf(event?.attributes, 'exception.escaped')).toEqual({
      boolValue: true,
    })
  })

  it('records a string exception as a message only', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    span.recordException('timed out')
    span.end()
    await som.flush()

    const [event] = collector.spans[0]?.events ?? []
    expect(attributeOf(event?.attributes, 'exception.message')).toEqual({
      stringValue: 'timed out',
    })
    expect(attributeOf(event?.attributes, 'exception.type')).toBeUndefined()
  })

  it('does not change the status when recording an exception', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    span.recordException(new Error('boom'))
    span.end()
    await som.flush()

    expect(collector.spans[0]).not.toHaveProperty('status')
  })
})

describe('span status', () => {
  it('sets an error status with its message', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    span.setStatus({ code: 'error', message: 'checkout failed' })
    span.end()
    await som.flush()

    expect(collector.spans[0]?.status).toEqual({
      code: OTelStatusCode.ERROR,
      message: 'checkout failed',
    })
  })

  it('drops the message for an ok status', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    span.setStatus({ code: 'ok', message: 'ignored' })
    span.end()
    await som.flush()

    expect(collector.spans[0]?.status).toEqual({ code: OTelStatusCode.OK })
  })

  it('lets ok replace error, but keeps ok final', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    span.setStatus({ code: 'error', message: 'first' })
    span.setStatus({ code: 'ok' })
    span.setStatus({ code: 'error', message: 'late' })
    span.end()
    await som.flush()

    expect(collector.spans[0]?.status).toEqual({ code: OTelStatusCode.OK })
  })
})

describe('span name', () => {
  it('uses the updated name', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('GET')
    span.updateName('GET /cart/:id')
    span.end()
    await som.flush()

    expect(collector.spans[0]?.name).toBe('GET /cart/:id')
  })
})

describe('ending a span', () => {
  it('exports once and ignores later changes', async () => {
    const { som, collector } = setup()

    const span = som.tracer.startSpan('x')
    expect(span.isRecording()).toBe(true)
    span.end()
    span.setAttribute('late', true)
    span.addEvent('late')
    span.recordException('late')
    span.setStatus({ code: 'error' })
    span.updateName('late')
    span.end()
    await som.flush()

    expect(span.isRecording()).toBe(false)
    expect(collector.spans).toHaveLength(1)
    expect(collector.spans[0]).toMatchObject({ name: 'x' })
    expect(collector.spans[0]).not.toHaveProperty('attributes')
    expect(collector.spans[0]).not.toHaveProperty('events')
    expect(collector.spans[0]).not.toHaveProperty('status')
  })

  it('never throws for an attribute that cannot be encoded', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      onDiagnostic: (event) => events.push(event),
    })

    const bad = som.tracer.startSpan('bad')
    bad.setAttribute('ratio', Number.NaN)
    expect(() => bad.end()).not.toThrow()
    som.tracer.startSpan('good').end()
    await som.flush()

    expect(collector.spans.map((span) => span.name)).toEqual(['good'])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'export-failed', recordCount: 1 }),
    )
  })
})
