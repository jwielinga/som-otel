import { afterEach, describe, expect, it, vi } from 'vitest'
import { OtlpExportError } from './http-exporter.js'
import type { OTelAnyValue } from './otel.types.js'
import type { OtlpLogRecord } from './otlp.js'
import { createSomLogger } from './sdk.js'
import type { SomLogger } from './logger.js'
import type { SomDiagnosticEvent, SomLoggerOptions } from './sdk.types.js'
import {
  FakeCollector,
  jsonResponse,
  statusResponse,
  type Script,
} from './test-support/fake-collector.js'
import { stubPage } from './test-support/page.js'
import { traceContextFromApi } from './trace-context.js'

// Every test builds the SDK through createSomLogger and observes it only via the collector.

const KEEPALIVE_LIMIT = 63 * 1024
const slowBatch = { maxBatchSize: 10, scheduledDelayMs: 60_000 }
const traceId = '5b8efff798038103d269b633813fc60c'
const spanId = 'eee19b7ec3c1b174'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// Fast retries and per-record batches by default; tests override what they exercise.
function createLogger(
  collector: FakeCollector,
  options: Partial<SomLoggerOptions> = {},
): SomLogger {
  return createSomLogger({
    endpoint: 'https://collector.example/v1/logs',
    serviceName: 'checkout',
    fetcher: collector.fetcher,
    batch: { maxBatchSize: 1 },
    detectResource: false,
    retry: { initialDelayMs: 1, maxDelayMs: 5 },
    ...options,
  })
}

function attribute(record: OtlpLogRecord | undefined, key: string) {
  return record?.attributes?.find((entry) => entry.key === key)?.value
}

const retryableFailures: Array<[string, Script]> = [
  ['HTTP 503', 503],
  ['HTTP 429', 429],
  ['HTTP 502', 502],
  ['HTTP 504', 504],
  ['a network error', new TypeError('Failed to fetch')],
]

describe('retry', () => {
  it.each(retryableFailures)(
    'retries after %s and delivers the same batch',
    async (_name, failure) => {
      const collector = new FakeCollector()
      collector.enqueue(failure, 204)
      const logger = createLogger(collector)

      await expect(logger.info('checkout failed')).resolves.toBeUndefined()

      expect(collector.requests).toHaveLength(2)
      expect(collector.requests[1]?.payload).toEqual(
        collector.requests[0]?.payload,
      )
      expect(collector.bodies).toEqual(['checkout failed', 'checkout failed'])
    },
  )

  it('uses exponential backoff by default', async () => {
    vi.useFakeTimers()
    const collector = new FakeCollector()
    collector.enqueue(503, 204)
    const logger = createLogger(collector, { retry: undefined })

    const pending = logger.info('x')
    await vi.advanceTimersByTimeAsync(0)
    expect(collector.requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(499)
    expect(collector.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(501)
    await pending

    expect(collector.requests).toHaveLength(2)
  })

  it('honors a short Retry-After', async () => {
    const collector = new FakeCollector()
    collector.enqueue(statusResponse(429, { 'Retry-After': '0' }), 204)

    await createLogger(collector).info('x')

    expect(collector.requests).toHaveLength(2)
  })

  it('stops when Retry-After exceeds retry.maxDelayMs', async () => {
    const collector = new FakeCollector()
    collector.enqueue(statusResponse(503, { 'Retry-After': '120' }))

    await expect(createLogger(collector).info('x')).rejects.toMatchObject({
      name: 'OtlpExportError',
      status: 503,
      retryable: true,
      retryAfterMs: 120_000,
    })
    expect(collector.requests).toHaveLength(1)
  })

  it('does not retry permanent failures', async () => {
    const collector = new FakeCollector()
    collector.enqueue(400)

    const error = await createLogger(collector)
      .info('x')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OtlpExportError)
    expect(error).toMatchObject({ status: 400, retryable: false })
    expect(collector.requests).toHaveLength(1)
  })

  it('gives up after retry.maxAttempts', async () => {
    const collector = new FakeCollector()
    collector.setFallback(503)
    const logger = createLogger(collector, {
      retry: { maxAttempts: 4, initialDelayMs: 1, maxDelayMs: 5 },
    })

    await expect(logger.info('x')).rejects.toThrow('503')

    expect(collector.requests).toHaveLength(4)
  })

  it('can be disabled', async () => {
    const collector = new FakeCollector()
    collector.enqueue(503, 204)

    await expect(
      createLogger(collector, { retry: false }).info('x'),
    ).rejects.toThrow('503')

    expect(collector.requests).toHaveLength(1)
  })

  it('fails the log promises of every record in a failed batch', async () => {
    const collector = new FakeCollector()
    collector.setFallback(500)
    const logger = createLogger(collector, { batch: { maxBatchSize: 3 } })

    const results = await Promise.allSettled([
      logger.info('a'),
      logger.info('b'),
      logger.info('c'),
    ])

    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ])
    expect(collector.requests).toHaveLength(1)
    expect(collector.requests[0]?.records).toHaveLength(3)
  })
})

describe('timeout', () => {
  it('aborts a hung request and rejects', async () => {
    const collector = new FakeCollector()
    collector.enqueue('hang')
    const logger = createLogger(collector, { timeoutMs: 25, retry: false })

    await expect(logger.info('x')).rejects.toThrow('timed out after 25ms')

    expect(collector.requests[0]?.signal?.aborted).toBe(true)
  })

  it('retries after a timeout', async () => {
    const collector = new FakeCollector()
    collector.enqueue('hang', 204)
    const logger = createLogger(collector, { timeoutMs: 25 })

    await expect(logger.info('x')).resolves.toBeUndefined()

    expect(collector.requests).toHaveLength(2)
    expect(collector.requests[0]?.signal?.aborted).toBe(true)
    expect(collector.requests[1]?.signal?.aborted).toBe(false)
  })

  it('does not abort requests that finish in time', async () => {
    const collector = new FakeCollector()

    await createLogger(collector, { timeoutMs: 1_000 }).info('x')

    expect(collector.requests[0]?.signal?.aborted).toBe(false)
  })

  it('lets timeoutMs: 0 disable the timeout', async () => {
    const collector = new FakeCollector()

    await createLogger(collector, { timeoutMs: 0 }).info('x')

    expect(collector.requests[0]?.signal).toBeUndefined()
  })
})

describe('page hide flush', () => {
  it('sends queued logs synchronously on pagehide with keepalive', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const logger = createLogger(collector, { batch: slowBatch })
    const pending = logger.info('last words')

    page.pagehide()

    expect(collector.requests).toHaveLength(1)
    expect(collector.requests[0]?.keepalive).toBe(true)
    await expect(pending).resolves.toBeUndefined()
    expect(collector.bodies).toEqual(['last words'])
  })

  it('flushes when the page becomes hidden, not when visible', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const logger = createLogger(collector, { batch: slowBatch })
    const pending = logger.info('tab switch')

    page.setVisibility('visible')
    expect(collector.requests).toHaveLength(0)

    page.setVisibility('hidden')
    expect(collector.requests).toHaveLength(1)
    await pending
  })

  it('sends immediately even while an earlier request is in flight', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const release = collector.hold()
    const logger = createLogger(collector, { batch: slowBatch })

    const first = logger.info('first')
    void logger.flush()
    await vi.waitFor(() => expect(collector.requests).toHaveLength(1))
    const second = logger.info('second')
    page.pagehide()

    expect(collector.bodies).toEqual(['first', 'second'])
    release()
    await Promise.all([first, second])
  })

  it('does not retry or compress unload requests', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    collector.setFallback(503)
    const logger = createLogger(collector, {
      batch: slowBatch,
      compression: 'gzip',
    })
    const pending = logger.info('x')

    page.pagehide()

    await expect(pending).rejects.toThrow('503')
    expect(collector.requests).toHaveLength(1)
    expect(collector.requests[0]?.compressed).toBe(false)
  })

  it('splits a large batch into requests that fit the keepalive limit', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const logger = createLogger(collector, { batch: slowBatch })
    const bodies = Array.from(
      { length: 6 },
      (_, index) => `${index}${'x'.repeat(20_000)}`,
    )
    const pending = bodies.map((body) => logger.info(body))

    page.pagehide()
    await Promise.all(pending)

    expect(collector.requests.length).toBeGreaterThan(1)
    for (const request of collector.requests) {
      expect(request.bodyBytes).toBeLessThanOrEqual(KEEPALIVE_LIMIT)
      expect(request.keepalive).toBe(true)
    }
    expect(collector.bodies).toEqual(bodies)
  })

  it('sends plain requests when fetch keepalive is unsupported', async () => {
    const page = stubPage({ keepaliveSupported: false })
    const collector = new FakeCollector()
    const logger = createLogger(collector, { batch: slowBatch })
    const pending = logger.info('no keepalive')

    page.pagehide()
    await pending

    expect(collector.requests).toHaveLength(1)
    expect(collector.requests[0]?.keepalive).toBe(false)
  })

  it('does not use keepalive when keepalive is turned off', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      batch: slowBatch,
      keepalive: false,
    })
    const pending = logger.info('opted out')

    page.pagehide()
    await pending

    expect(collector.requests[0]?.keepalive).toBe(false)
  })

  it('stops listening after shutdown', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const logger = createLogger(collector, { batch: slowBatch })
    expect(page.listenerCount()).toBe(2)

    const pending = logger.info('before shutdown')
    await logger.shutdown()
    await pending

    expect(page.listenerCount()).toBe(0)
    expect(collector.bodies).toEqual(['before shutdown'])
  })
})

describe('queue overflow', () => {
  it('drops the oldest queued record with drop-oldest', async () => {
    const collector = new FakeCollector()
    const release = collector.hold()
    const events: SomDiagnosticEvent[] = []
    const logger = createLogger(collector, {
      batch: {
        maxBatchSize: 1,
        maxQueueSize: 1,
        overflowStrategy: 'drop-oldest',
      },
      onDiagnostic: (event) => events.push(event),
    })

    const inFlight = logger.info('in flight')
    const dropped = logger.info('dropped')
    const kept = logger.info('kept')

    await expect(dropped).rejects.toThrow('oldest record dropped')
    release()
    await Promise.all([inFlight, kept])

    expect(collector.bodies).toEqual(['in flight', 'kept'])
    expect(logger.droppedRecordCount).toBe(1)
    expect(events).toContainEqual({
      type: 'records-dropped',
      signal: 'logs',
      reason: 'queue-full',
      totalDropped: 1,
    })
  })

  it('rejects the new record by default and still counts it', async () => {
    const collector = new FakeCollector()
    const release = collector.hold()
    const logger = createLogger(collector, {
      batch: { maxBatchSize: 1, maxQueueSize: 1 },
    })

    const inFlight = logger.info('in flight')
    const queued = logger.info('queued')
    const rejected = logger.info('rejected')

    await expect(rejected).rejects.toThrow('batch queue is full.')
    release()
    await Promise.all([inFlight, queued])

    expect(collector.bodies).toEqual(['in flight', 'queued'])
    expect(logger.droppedRecordCount).toBe(1)
  })
})

describe('partial success', () => {
  it('reports rejected records without failing or retrying', async () => {
    const events: SomDiagnosticEvent[] = []
    const collector = new FakeCollector()
    collector.enqueue(
      jsonResponse({
        partialSuccess: {
          rejectedLogRecords: '2',
          errorMessage: 'attribute too long',
        },
      }),
    )
    const logger = createLogger(collector, {
      onDiagnostic: (event) => events.push(event),
    })

    await expect(logger.info('x')).resolves.toBeUndefined()

    expect(collector.requests).toHaveLength(1)
    expect(events).toEqual([
      {
        type: 'partial-success',
        signal: 'logs',
        rejectedLogRecords: 2,
        errorMessage: 'attribute too long',
      },
    ])
  })

  it('stays quiet for a plain success response', async () => {
    const events: SomDiagnosticEvent[] = []
    const collector = new FakeCollector()
    collector.enqueue(
      jsonResponse({}),
      jsonResponse({ partialSuccess: {} }),
      204,
    )
    const logger = createLogger(collector, {
      onDiagnostic: (event) => events.push(event),
    })

    await logger.info('a')
    await logger.info('b')
    await logger.info('c')

    expect(events).toEqual([])
  })

  it('survives a throwing diagnostics callback', async () => {
    const collector = new FakeCollector()
    collector.enqueue(
      jsonResponse({ partialSuccess: { rejectedLogRecords: '1' } }),
    )
    const logger = createLogger(collector, {
      onDiagnostic: () => {
        throw new Error('callback bug')
      },
    })

    await expect(logger.info('x')).resolves.toBeUndefined()
    expect(collector.requests).toHaveLength(1)
  })
})

describe('diagnostics', () => {
  it('reports each failed export with its record count', async () => {
    const events: SomDiagnosticEvent[] = []
    const collector = new FakeCollector()
    collector.setFallback(500)
    const logger = createLogger(collector, {
      batch: { maxBatchSize: 2 },
      retry: false,
      onDiagnostic: (event) => events.push(event),
    })

    await Promise.allSettled([logger.info('a'), logger.info('b')])

    expect(events).toEqual([
      expect.objectContaining({ type: 'export-failed', recordCount: 2 }),
    ])
  })
})

describe('trace correlation', () => {
  it('attaches the traceContext provider to helper and raw logs', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      traceContext: () => ({ traceId, spanId, traceFlags: 0x101 }),
    })

    await logger.info('helper')
    await logger.logRecord({ body: 'raw' })

    for (const record of collector.records) {
      expect(record).toMatchObject({ traceId, spanId, flags: 1 })
    }
  })

  it('correlates with the active span through @opentelemetry/api', async () => {
    const collector = new FakeCollector()
    const span: {
      current?: { traceId: string; spanId: string; traceFlags: number }
    } = {}
    const logger = createLogger(collector, {
      traceContext: traceContextFromApi({
        context: { active: () => ({}) },
        trace: { getSpanContext: () => span.current },
      }),
    })

    await logger.info('outside any span')
    span.current = { traceId, spanId, traceFlags: 1 }
    await logger.info('inside a span')

    expect(collector.records[0]?.traceId).toBeUndefined()
    expect(collector.records[1]).toMatchObject({ traceId, spanId, flags: 1 })
  })

  it('prefers explicit ids and sets the event name', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      traceContext: () => ({ traceId, spanId }),
    })

    await logger.warn(
      'slow checkout',
      {},
      {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1,
        eventName: 'checkout.slow',
      },
    )

    expect(collector.records[0]).toMatchObject({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      flags: 1,
      eventName: 'checkout.slow',
    })
  })

  it('keeps an event name when the provider supplies the trace', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      traceContext: () => ({ traceId, spanId }),
    })

    await logger.info('x', {}, { eventName: 'checkout.done' })

    expect(collector.records[0]).toMatchObject({
      traceId,
      spanId,
      eventName: 'checkout.done',
    })
  })

  it('does not override ids already on a raw record', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      traceContext: () => ({ traceId, spanId }),
    })

    await logger.logRecord({ body: 'x', traceId: 'a'.repeat(32) })

    expect(collector.records[0]).toMatchObject({ traceId: 'a'.repeat(32) })
    expect(collector.records[0]?.spanId).toBeUndefined()
  })

  it('masks trace flags to their low 8 bits', async () => {
    const collector = new FakeCollector()

    await createLogger(collector).info(
      'x',
      {},
      { traceId, spanId, traceFlags: 0x1ff },
    )

    expect(collector.records[0]?.flags).toBe(0xff)
  })
})

describe('timestamps', () => {
  it('sets time and observed time to the same current instant', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector)
    const before = Date.now()

    await logger.info('x')

    const record = collector.records[0]
    expect(record?.timeUnixNano).toMatch(/^\d{19}$/)
    expect(record?.observedTimeUnixNano).toBe(record?.timeUnixNano)
    const sentMs = Number(BigInt(record?.timeUnixNano ?? '0') / 1_000_000n)
    expect(sentMs).toBeGreaterThanOrEqual(before - 1_000)
    expect(sentMs).toBeLessThanOrEqual(Date.now() + 1_000)
  })

  it('has sub-millisecond precision and never goes backwards', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector)

    for (let index = 0; index < 20; index++) await logger.info(`log ${index}`)

    const times = collector.records.map((record) =>
      BigInt(record.timeUnixNano ?? '0'),
    )
    expect(times.some((time) => time % 1_000_000n !== 0n)).toBe(true)
    for (let index = 1; index < times.length; index++) {
      expect(times[index]! >= times[index - 1]!).toBe(true)
    }
  })

  it('stamps observed time on raw records unless provided', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector)

    await logger.logRecord({ body: 'a' })
    await logger.logRecord({ body: 'b', observedTimeUnixNano: 5n })

    expect(collector.records[0]?.observedTimeUnixNano).toMatch(/^\d{19}$/)
    expect(collector.records[0]?.timeUnixNano).toBeUndefined()
    expect(collector.records[1]?.observedTimeUnixNano).toBe('5')
  })
})

describe('scope and schema URLs', () => {
  it('defaults to the som scope without schema URLs', async () => {
    const collector = new FakeCollector()

    await createLogger(collector).info('x')

    const resourceLogs = collector.requests[0]?.payload.resourceLogs[0]
    expect(resourceLogs?.scopeLogs[0]?.scope).toEqual({ name: 'som' })
    expect(resourceLogs).not.toHaveProperty('schemaUrl')
    expect(resourceLogs?.scopeLogs[0]).not.toHaveProperty('schemaUrl')
  })

  it('applies configured scope and schema URLs', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      scope: {
        name: 'storefront-web',
        version: '2.1.0',
        attributes: { area: 'checkout' },
        schemaUrl: 'https://opentelemetry.io/schemas/1.27.0',
      },
      resourceSchemaUrl: 'https://opentelemetry.io/schemas/1.26.0',
    })

    await logger.info('x')

    const resourceLogs = collector.requests[0]?.payload.resourceLogs[0]
    expect(resourceLogs?.schemaUrl).toBe(
      'https://opentelemetry.io/schemas/1.26.0',
    )
    expect(resourceLogs?.scopeLogs[0]).toMatchObject({
      schemaUrl: 'https://opentelemetry.io/schemas/1.27.0',
      scope: {
        name: 'storefront-web',
        version: '2.1.0',
        attributes: [{ key: 'area', value: { stringValue: 'checkout' } }],
      },
    })
  })
})

describe('compression', () => {
  it('gzips request bodies and sets Content-Encoding', async () => {
    const collector = new FakeCollector()

    await createLogger(collector, { compression: 'gzip' }).info('compress me')

    const request = collector.requests[0]
    expect(request?.compressed).toBe(true)
    expect(request?.headers['content-encoding']).toBe('gzip')
    expect(request?.headers['content-type']).toBe('application/json')
    expect(collector.bodies).toEqual(['compress me'])
  })

  it('is off by default', async () => {
    const collector = new FakeCollector()

    await createLogger(collector).info('x')

    expect(collector.requests[0]?.compressed).toBe(false)
    expect(collector.requests[0]?.headers).not.toHaveProperty(
      'content-encoding',
    )
  })

  it('falls back to uncompressed without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const collector = new FakeCollector()

    await createLogger(collector, { compression: 'gzip' }).info('x')

    expect(collector.requests[0]?.compressed).toBe(false)
    expect(collector.requests[0]?.headers).not.toHaveProperty(
      'content-encoding',
    )
  })

  it('judges the keepalive limit on the compressed size', async () => {
    stubPage({ keepaliveSupported: true })
    const collector = new FakeCollector()
    const compressible = 'x'.repeat(100_000)

    await createLogger(collector, { compression: 'gzip' }).info(compressible)
    await createLogger(collector).info(compressible)

    expect(collector.requests[0]?.keepalive).toBe(true)
    expect(collector.requests[1]?.keepalive).toBe(false)
  })
})

describe('resource detection', () => {
  function resourceAttributes(collector: FakeCollector) {
    return collector.requests[0]?.payload.resourceLogs[0]?.resource.attributes
  }

  it('adds browser attributes by default', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'TestAgent/1',
      language: 'nl-NL',
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '120' }],
        mobile: false,
        platform: 'macOS',
      },
    })
    const collector = new FakeCollector()

    await createLogger(collector, { detectResource: undefined }).info('x')

    const attributes = Object.fromEntries(
      (resourceAttributes(collector) ?? []).map(({ key, value }) => [
        key,
        value,
      ]),
    )
    expect(attributes).toMatchObject({
      'telemetry.sdk.name': { stringValue: 'som-otel' },
      'telemetry.sdk.language': { stringValue: 'webjs' },
      'user_agent.original': { stringValue: 'TestAgent/1' },
      'browser.language': { stringValue: 'nl-NL' },
      'browser.mobile': { boolValue: false },
      'browser.platform': { stringValue: 'macOS' },
      'service.name': { stringValue: 'checkout' },
    })
    expect(attributes['browser.brands']).toEqual({
      arrayValue: { values: [{ stringValue: 'Chromium 120' }] },
    })
  })

  it('lets user resource attributes override detected ones', async () => {
    vi.stubGlobal('navigator', { language: 'nl-NL' })
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      detectResource: true,
      serviceVersion: '1.2.3',
      resourceAttributes: {
        'browser.language': 'fr-FR',
        'service.name': 'ignored',
      },
    })

    await logger.info('x')

    const attributes = resourceAttributes(collector)
    expect(attributes).toContainEqual({
      key: 'browser.language',
      value: { stringValue: 'fr-FR' },
    })
    expect(attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'checkout' },
    })
    expect(attributes).toContainEqual({
      key: 'service.version',
      value: { stringValue: '1.2.3' },
    })
  })

  it('can be turned off', async () => {
    vi.stubGlobal('navigator', { userAgent: 'TestAgent/1' })
    const collector = new FakeCollector()

    await createLogger(collector, { detectResource: false }).info('x')

    expect(resourceAttributes(collector)).toEqual([
      { key: 'service.name', value: { stringValue: 'checkout' } },
    ])
  })
})

describe('attribute limits', () => {
  it('drops attributes over the count limit and counts them', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      limits: { attributeCountLimit: 2 },
    })

    await logger.info('x', { a: 1, b: 2, c: 3, d: 4 })

    const record = collector.records[0]
    expect(record?.attributes?.map(({ key }) => key)).toEqual(['a', 'b'])
    expect(record?.droppedAttributesCount).toBe(2)
  })

  it('applies the default count limit of 128', async () => {
    const collector = new FakeCollector()
    const attributes = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [`k${index}`, index]),
    )

    await createLogger(collector).info('x', attributes)

    expect(collector.records[0]?.attributes).toHaveLength(128)
    expect(collector.records[0]?.droppedAttributesCount).toBe(2)
  })

  it('truncates string attributes but not the body', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      limits: { attributeValueLengthLimit: 5 },
    })

    await logger.info('a long body stays intact', {
      text: 'abcdefgh',
      list: ['abcdefgh'],
      nested: { inner: 'abcdefgh' },
    })

    const record = collector.records[0]
    expect(record?.body).toEqual({ stringValue: 'a long body stays intact' })
    expect(attribute(record, 'text')).toEqual({ stringValue: 'abcde' })
    expect(JSON.stringify(record?.attributes)).not.toContain('abcdef')
  })

  it('replaces values nested deeper than maxValueDepth', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, { limits: { maxValueDepth: 2 } })

    await logger.info('x', { deep: { b: { c: { d: 1 } } } })

    expect(
      attribute(collector.records[0], 'deep')?.kvlistValue?.values?.[0]?.value
        ?.kvlistValue?.values?.[0],
    ).toEqual({ key: 'c', value: { stringValue: '[MaxDepthExceeded]' } })
  })

  it('survives circular references', async () => {
    const collector = new FakeCollector()
    const loop: Record<string, OTelAnyValue> = { name: 'loop' }
    loop.self = loop

    await createLogger(collector).info('x', { loop })

    expect(
      attribute(collector.records[0], 'loop')?.kvlistValue?.values?.[1],
    ).toEqual({ key: 'self', value: { stringValue: '[Circular]' } })
  })
})

describe('Error serialization', () => {
  it('logs the message as body with exception attributes', async () => {
    const collector = new FakeCollector()

    await createLogger(collector).error(new TypeError('boom'), {
      orderId: 'o-1',
    })

    const record = collector.records[0]
    expect(record?.body).toEqual({ stringValue: 'boom' })
    expect(record?.attributes?.map(({ key }) => key)).toEqual([
      'exception.type',
      'exception.message',
      'exception.stacktrace',
      'orderId',
    ])
    expect(attribute(record, 'exception.type')).toEqual({
      stringValue: 'TypeError',
    })
    expect(attribute(record, 'exception.stacktrace')?.stringValue).toContain(
      'boom',
    )
  })

  it('names errors after their class when name is the default', async () => {
    class PaymentDeclinedError extends Error {}
    const collector = new FakeCollector()

    await createLogger(collector).error(new PaymentDeclinedError('declined'))

    expect(attribute(collector.records[0], 'exception.type')).toEqual({
      stringValue: 'PaymentDeclinedError',
    })
  })

  it('serializes an Error attribute as a map', async () => {
    const collector = new FakeCollector()

    await createLogger(collector).warn('retrying', {
      cause: new RangeError('out of range'),
    })

    const fields = attribute(collector.records[0], 'cause')?.kvlistValue?.values
    expect(fields?.map(({ key }) => key)).toEqual([
      'type',
      'message',
      'stacktrace',
    ])
    expect(fields?.[0]?.value).toEqual({ stringValue: 'RangeError' })
    expect(fields?.[1]?.value).toEqual({ stringValue: 'out of range' })
  })

  it('applies the string length limit to stack traces', async () => {
    const collector = new FakeCollector()
    const logger = createLogger(collector, {
      limits: { attributeValueLengthLimit: 10 },
    })

    await logger.error(new Error('a very long error message'))

    expect(
      attribute(collector.records[0], 'exception.stacktrace')?.stringValue,
    ).toHaveLength(10)
  })
})
