import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSom } from '../core/sdk.js'
import {
  FakeCollector,
  type CollectedRequest,
} from '../test-support/fake-collector.js'
import {
  logRequestProblems,
  traceRequestProblems,
} from '../test-support/otlp-schema.js'
import { setupSom } from '../test-support/som.js'

// Input to output: what the app calls, and the exact OTLP/JSON request a collector receives.
// Every request is also checked against the OTLP/JSON schema (see otlp-schema.ts).

const START = 1767225600000 // 2026-01-01T00:00:00Z in epoch milliseconds
const NOW = '2026-10-05T12:00:00.000Z'
const NOW_NANO = '1791201600000000000'

const traceId = '01'.repeat(16)
const rootSpanId = '02'.repeat(8)
const childSpanId = '03'.repeat(8)

// Each random draw fills the buffer with the next number: ids become predictable.
function stubSequentialIds() {
  let draw = 0
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => bytes.fill(++draw),
  })
}

function nano(offsetMs: number): string {
  return String(BigInt(START + offsetMs) * 1_000_000n)
}

function sole(collector: FakeCollector): CollectedRequest {
  expect(collector.requests).toHaveLength(1)
  return collector.requests[0]!
}

beforeEach(() => {
  stubSequentialIds()
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('traces: input to output', () => {
  it('sends a client span with every field, and a child span that links elsewhere', async () => {
    const { som, collector } = setupSom({
      serviceVersion: '2.1.0',
      resourceAttributes: { 'deployment.environment.name': 'test' },
      scope: { name: 'storefront-web', version: '2.1.0' },
      batch: { maxBatchSize: 10, scheduledDelayMs: 60_000 },
    })
    const failure = new TypeError('bad cart')
    failure.stack = 'TypeError: bad cart\n    at checkout'

    const root = som.tracer.startSpan('GET /cart/:id', {
      kind: 'client',
      startTime: START,
      attributes: {
        'http.request.method': 'GET',
        'url.full': 'https://shop.example/cart/42',
      },
    })
    root.setAttribute('http.response.status_code', 200)
    root.setAttribute('cart.total', 12.5)
    root.addEvent('cache.miss', { 'cache.key': 'cart-42' }, START + 100)
    root.recordException(failure, {}, START + 200)
    root.setStatus({ code: 'error', message: 'upstream failed' })

    const child = som.tracer.startSpan('SELECT cart', {
      kind: 'client',
      parent: root,
      startTime: START + 10,
      links: [
        {
          context: {
            traceId: 'cc'.repeat(16),
            spanId: 'dd'.repeat(8),
            traceFlags: 1,
          },
          attributes: { 'link.reason': 'retry' },
        },
      ],
    })
    child.end(START + 50)
    root.end(START + 500)
    await som.flush()

    const request = sole(collector)
    expect(request.url).toBe('https://collector.example/v1/traces')
    expect(traceRequestProblems(request.body)).toEqual([])
    expect(request.payload.resourceSpans).toEqual([
      {
        resource: {
          attributes: [
            {
              key: 'deployment.environment.name',
              value: { stringValue: 'test' },
            },
            { key: 'service.name', value: { stringValue: 'checkout' } },
            { key: 'service.version', value: { stringValue: '2.1.0' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'storefront-web', version: '2.1.0' },
            spans: [
              {
                traceId,
                spanId: childSpanId,
                parentSpanId: rootSpanId,
                flags: 1,
                name: 'SELECT cart',
                kind: 3,
                startTimeUnixNano: nano(10),
                endTimeUnixNano: nano(50),
                links: [
                  {
                    traceId: 'cc'.repeat(16),
                    spanId: 'dd'.repeat(8),
                    flags: 1,
                    attributes: [
                      { key: 'link.reason', value: { stringValue: 'retry' } },
                    ],
                  },
                ],
              },
              {
                traceId,
                spanId: rootSpanId,
                flags: 1,
                name: 'GET /cart/:id',
                kind: 3,
                startTimeUnixNano: nano(0),
                endTimeUnixNano: nano(500),
                attributes: [
                  { key: 'http.request.method', value: { stringValue: 'GET' } },
                  {
                    key: 'url.full',
                    value: { stringValue: 'https://shop.example/cart/42' },
                  },
                  {
                    key: 'http.response.status_code',
                    value: { intValue: '200' },
                  },
                  { key: 'cart.total', value: { doubleValue: 12.5 } },
                ],
                events: [
                  {
                    timeUnixNano: nano(100),
                    name: 'cache.miss',
                    attributes: [
                      { key: 'cache.key', value: { stringValue: 'cart-42' } },
                    ],
                  },
                  {
                    timeUnixNano: nano(200),
                    name: 'exception',
                    attributes: [
                      {
                        key: 'exception.type',
                        value: { stringValue: 'TypeError' },
                      },
                      {
                        key: 'exception.message',
                        value: { stringValue: 'bad cart' },
                      },
                      {
                        key: 'exception.stacktrace',
                        value: {
                          stringValue: 'TypeError: bad cart\n    at checkout',
                        },
                      },
                    ],
                  },
                ],
                status: { code: 2, message: 'upstream failed' },
              },
            ],
          },
        ],
      },
    ])
  })

  it('sends the minimal span a collector needs, with default scope and no extras', async () => {
    const { som, collector } = setupSom()

    som.tracer.startSpan('tick', { startTime: START }).end(START + 1)
    await som.flush()

    const request = sole(collector)
    expect(traceRequestProblems(request.body)).toEqual([])
    expect(request.payload.resourceSpans).toEqual([
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'som' },
            spans: [
              {
                traceId,
                spanId: rootSpanId,
                flags: 1,
                name: 'tick',
                kind: 1,
                startTimeUnixNano: nano(0),
                endTimeUnixNano: nano(1),
              },
            ],
          },
        ],
      },
    ])
  })

  it('continues a trace from another service by its ids', async () => {
    const { som, collector } = setupSom()

    som.tracer
      .startSpan('handle', {
        kind: 'server',
        parent: {
          traceId: 'AB'.repeat(16),
          spanId: 'CD'.repeat(8),
          traceFlags: 1,
        },
      })
      .end()
    await som.flush()

    expect(traceRequestProblems(collector.requests[0]?.body)).toEqual([])
    expect(collector.spans[0]).toMatchObject({
      traceId: 'ab'.repeat(16),
      parentSpanId: 'cd'.repeat(8),
      kind: 2,
      flags: 1,
    })
  })

  it('starts a new valid trace when the parent ids are invalid', async () => {
    const { som, collector } = setupSom()

    som.tracer
      .startSpan('handle', {
        parent: { traceId: 'not-a-trace-id', spanId: '0'.repeat(16) },
      })
      .end()
    await som.flush()

    expect(traceRequestProblems(collector.requests[0]?.body)).toEqual([])
    expect(collector.spans[0]).toMatchObject({ traceId })
    expect(collector.spans[0]).not.toHaveProperty('parentSpanId')
  })

  it('never exports spans that are not sampled', async () => {
    const { som, collector } = setupSom()

    som.tracer
      .startSpan('skipped', {
        parent: {
          traceId: 'ab'.repeat(16),
          spanId: 'cd'.repeat(8),
          traceFlags: 0,
        },
      })
      .end()
    await som.flush()

    expect(collector.requests).toEqual([])
  })

  it('sends every attribute value type as a valid AnyValue', async () => {
    const { som, collector } = setupSom()

    som.tracer
      .startSpan('values', {
        attributes: {
          text: 'a',
          flag: true,
          count: 3,
          ratio: 0.25,
          big: 2n ** 62n,
          bytes: new Uint8Array([1, 2, 3]),
          list: [1, 'two', false],
          nested: { inner: { deep: 1.5 } },
          failure: new RangeError('out of range'),
        },
      })
      .end()
    await som.flush()

    expect(traceRequestProblems(collector.requests[0]?.body)).toEqual([])
    const attributes = collector.spans[0]?.attributes
    expect(attributes?.find((entry) => entry.key === 'count')?.value).toEqual({
      intValue: '3',
    })
    expect(attributes?.find((entry) => entry.key === 'ratio')?.value).toEqual({
      doubleValue: 0.25,
    })
    expect(attributes?.find((entry) => entry.key === 'big')?.value).toEqual({
      intValue: '4611686018427387904',
    })
    expect(attributes?.find((entry) => entry.key === 'bytes')?.value).toEqual({
      bytesValue: 'AQID',
    })
  })

  it('stays valid when limits drop and truncate data', async () => {
    const { som, collector } = setupSom({
      limits: {
        attributeCountLimit: 1,
        attributeValueLengthLimit: 3,
        eventCountLimit: 1,
        linkCountLimit: 1,
      },
    })
    const link = {
      context: { traceId: 'cc'.repeat(16), spanId: 'dd'.repeat(8) },
    }

    const span = som.tracer.startSpan('limited', {
      attributes: { a: 'abcdef', b: 2 },
    })
    span.addEvent('one', { x: 'abcdef', y: 1 })
    span.addEvent('two')
    span.addLink(link).addLink(link)
    span.end()
    await som.flush()

    expect(traceRequestProblems(collector.requests[0]?.body)).toEqual([])
    expect(collector.spans[0]).toMatchObject({
      attributes: [{ key: 'a', value: { stringValue: 'abc' } }],
      droppedAttributesCount: 1,
      events: [{ name: 'one', droppedAttributesCount: 1 }],
      droppedEventsCount: 1,
      droppedLinksCount: 1,
    })
  })

  it('gzips a valid request when compression is on', async () => {
    const { som, collector } = setupSom({ compression: 'gzip' })

    som.tracer.startSpan('compressed').end()
    await som.flush()

    const request = sole(collector)
    expect(request.compressed).toBe(true)
    expect(traceRequestProblems(request.body)).toEqual([])
  })
})

describe('logs: input to output', () => {
  it('sends a log correlated with a span, with typed attributes', async () => {
    const { som, collector } = setupSom({
      serviceVersion: '2.1.0',
      scope: { name: 'storefront-web' },
    })
    const root = som.tracer.startSpan('checkout')

    await som.logger.info(
      'Charging card',
      { orderId: 'order-42', attempt: 2, amount: 12.5, retried: false },
      { span: root, eventName: 'checkout.charge' },
    )

    const request = sole(collector)
    expect(request.url).toBe('https://collector.example/v1/logs')
    expect(logRequestProblems(request.body)).toEqual([])
    expect(request.payload.resourceLogs).toEqual([
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout' } },
            { key: 'service.version', value: { stringValue: '2.1.0' } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'storefront-web' },
            logRecords: [
              {
                timeUnixNano: NOW_NANO,
                observedTimeUnixNano: NOW_NANO,
                severityNumber: 9,
                severityText: 'INFO',
                body: { stringValue: 'Charging card' },
                attributes: [
                  { key: 'orderId', value: { stringValue: 'order-42' } },
                  { key: 'attempt', value: { intValue: '2' } },
                  { key: 'amount', value: { doubleValue: 12.5 } },
                  { key: 'retried', value: { boolValue: false } },
                ],
                flags: 1,
                traceId,
                spanId: rootSpanId,
                eventName: 'checkout.charge',
              },
            ],
          },
        ],
      },
    ])
  })

  it('sends a logged Error as exception attributes with the message as body', async () => {
    const { som, collector } = setupSom()
    const failure = new TypeError('bad cart')
    failure.stack = 'TypeError: bad cart\n    at checkout'

    await som.logger.error(failure, { orderId: 'order-42' })

    const request = sole(collector)
    expect(logRequestProblems(request.body)).toEqual([])
    expect(request.records).toEqual([
      {
        timeUnixNano: NOW_NANO,
        observedTimeUnixNano: NOW_NANO,
        severityNumber: 17,
        severityText: 'ERROR',
        body: { stringValue: 'bad cart' },
        attributes: [
          { key: 'exception.type', value: { stringValue: 'TypeError' } },
          { key: 'exception.message', value: { stringValue: 'bad cart' } },
          {
            key: 'exception.stacktrace',
            value: { stringValue: 'TypeError: bad cart\n    at checkout' },
          },
          { key: 'orderId', value: { stringValue: 'order-42' } },
        ],
      },
    ])
  })

  it('sends a raw record with its own timestamps and severity', async () => {
    const { som, collector } = setupSom()

    await som.logger.logRecord({
      timeUnixNano: 1767225600000000000n,
      severityNumber: 13,
      severityText: 'WARN',
      body: { message: 'low stock', sku: 'sku-1' },
      attributes: { remaining: 2 },
    })

    const request = sole(collector)
    expect(logRequestProblems(request.body)).toEqual([])
    expect(request.records[0]).toEqual({
      timeUnixNano: '1767225600000000000',
      observedTimeUnixNano: NOW_NANO,
      severityNumber: 13,
      severityText: 'WARN',
      body: {
        kvlistValue: {
          values: [
            { key: 'message', value: { stringValue: 'low stock' } },
            { key: 'sku', value: { stringValue: 'sku-1' } },
          ],
        },
      },
      attributes: [{ key: 'remaining', value: { intValue: '2' } }],
    })
  })

  it('keeps log and span requests separate, each valid for its own endpoint', async () => {
    const { som, collector } = setupSom({
      batch: { maxBatchSize: 10, scheduledDelayMs: 60_000 },
    })

    void som.logger.warn('slow')
    som.tracer.startSpan('work').end()
    await som.flush()

    const byUrl = new Map(
      collector.requests.map((request) => [request.url, request]),
    )
    expect(
      logRequestProblems(byUrl.get('https://collector.example/v1/logs')?.body),
    ).toEqual([])
    expect(
      traceRequestProblems(
        byUrl.get('https://collector.example/v1/traces')?.body,
      ),
    ).toEqual([])
    expect(byUrl.get('https://collector.example/v1/logs')?.spans).toEqual([])
    expect(byUrl.get('https://collector.example/v1/traces')?.records).toEqual(
      [],
    )
  })
})

// A collector rejects a whole request over one malformed id, so these must never be sent.
describe('malformed trace ids', () => {
  const bad = { traceId: 'xyz', spanId: 'q' }

  it('are left out of logs, whichever way they were supplied', async () => {
    const { som, collector } = setupSom({
      traceContext: () => ({ traceId: 'a'.repeat(31), spanId: 'b'.repeat(16) }),
      batch: { maxBatchSize: 10, scheduledDelayMs: 60_000 },
    })

    const logged = [
      som.logger.info('explicit', {}, { ...bad, traceFlags: 1 }),
      som.logger.info('provider'),
      som.logger.logRecord({ body: 'raw', ...bad }),
      som.logger.info(
        'valid',
        {},
        { traceId: 'A'.repeat(32), spanId: 'B'.repeat(16) },
      ),
    ]
    await som.flush()
    await Promise.all(logged)

    const request = sole(collector)
    expect(logRequestProblems(request.body)).toEqual([])
    const [explicit, provider, raw, valid] = request.records
    for (const record of [explicit, provider, raw]) {
      expect(record).not.toHaveProperty('traceId')
      expect(record).not.toHaveProperty('spanId')
    }
    expect(valid).toMatchObject({
      traceId: 'A'.repeat(32),
      spanId: 'B'.repeat(16),
    })
  })

  it('are left out of span links, and the span is still sent', async () => {
    const { som, collector } = setupSom()

    const span = som.tracer.startSpan('linked', { links: [{ context: bad }] })
    span.addLink({
      context: { traceId: '0'.repeat(32), spanId: 'b'.repeat(16) },
    })
    span.addLink({
      context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    })
    span.end()
    await som.flush()

    const request = sole(collector)
    expect(traceRequestProblems(request.body)).toEqual([])
    expect(collector.spans[0]?.links).toHaveLength(1)
    expect(collector.spans[0]).not.toHaveProperty('droppedLinksCount')
  })
})

describe('resource attributes', () => {
  it('describe the SDK and the app when detection is on', async () => {
    vi.stubGlobal('navigator', { userAgent: 'TestAgent/1', language: 'nl-NL' })
    const collector = new FakeCollector()
    const som = createSom({
      endpoint: 'https://collector.example/v1/logs',
      serviceName: 'checkout',
      fetcher: collector.fetcher,
      batch: { maxBatchSize: 1 },
    })

    som.tracer.startSpan('x').end()
    await som.flush()

    const attributes = Object.fromEntries(
      (
        collector.requests[0]?.payload.resourceSpans[0]?.resource.attributes ??
        []
      ).map(({ key, value }) => [key, value]),
    )
    expect(attributes).toMatchObject({
      'service.name': { stringValue: 'checkout' },
      'telemetry.sdk.name': { stringValue: 'som-otel' },
      'telemetry.sdk.language': { stringValue: 'webjs' },
      'user_agent.original': { stringValue: 'TestAgent/1' },
    })
  })
})
