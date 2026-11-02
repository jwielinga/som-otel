import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OtlpExportError } from './http-exporter.js'
import type {
  OTelJsonLogRecord,
  OTelJsonResource,
  OTelJsonSpan,
} from './otel.types.js'
import { createSom } from './sdk.js'
import type { SomDiagnosticEvent, SomOptions } from './sdk.types.js'
import {
  isDockerAvailable,
  startCollector,
  type ForwardedExport,
  type RunningCollector,
} from './test-support/otel-collector.js'

// Runs against a real OpenTelemetry Collector in Docker: `pnpm test:collector`.
// The collector rejects requests it cannot parse, and forwards the rest as JSON, so these
// tests show that what Som sends is accepted and keeps its meaning.

type Forwarded<T> = { resource: OTelJsonResource; item: T }

function serviceName(resource: OTelJsonResource): unknown {
  return resource.attributes?.find((entry) => entry.key === 'service.name')
    ?.value?.stringValue
}

function forwardedSpans(
  forwarded: ForwardedExport[],
  service: string,
): Array<Forwarded<OTelJsonSpan>> {
  return forwarded
    .filter((entry) => entry.path === '/v1/traces')
    .flatMap(
      (entry) =>
        (
          entry.body as {
            resourceSpans?: Array<{
              resource: OTelJsonResource
              scopeSpans: Array<{ spans: OTelJsonSpan[] }>
            }>
          }
        ).resourceSpans ?? [],
    )
    .filter(({ resource }) => serviceName(resource) === service)
    .flatMap(({ resource, scopeSpans }) =>
      scopeSpans.flatMap(({ spans }) =>
        spans.map((item) => ({ resource, item })),
      ),
    )
}

function forwardedLogs(
  forwarded: ForwardedExport[],
  service: string,
): Array<Forwarded<OTelJsonLogRecord>> {
  return forwarded
    .filter((entry) => entry.path === '/v1/logs')
    .flatMap(
      (entry) =>
        (
          entry.body as {
            resourceLogs?: Array<{
              resource: OTelJsonResource
              scopeLogs: Array<{ logRecords: OTelJsonLogRecord[] }>
            }>
          }
        ).resourceLogs ?? [],
    )
    .filter(({ resource }) => serviceName(resource) === service)
    .flatMap(({ resource, scopeLogs }) =>
      scopeLogs.flatMap(({ logRecords }) =>
        logRecords.map((item) => ({ resource, item })),
      ),
    )
}

const dockerAvailable = await isDockerAvailable()

describe.skipIf(!dockerAvailable)('real OpenTelemetry Collector', () => {
  let collector: RunningCollector

  beforeAll(async () => {
    collector = await startCollector()
  }, 180_000)

  afterAll(async () => {
    await collector.stop()
  })

  function setup(name: string, options: Partial<SomOptions> = {}) {
    const diagnostics: SomDiagnosticEvent[] = []
    const som = createSom({
      endpoint: `${collector.url}/v1/logs`,
      serviceName: name,
      serviceVersion: '1.2.3',
      batch: { maxBatchSize: 100, scheduledDelayMs: 60_000 },
      retry: false,
      onDiagnostic: (event) => diagnostics.push(event),
      ...options,
    })
    return { som, diagnostics }
  }

  it('accepts spans with every field and forwards them unchanged', async () => {
    const service = 'collector-test-spans'
    const { som, diagnostics } = setup(service, {
      resourceAttributes: { 'deployment.environment.name': 'test' },
      scope: { name: 'storefront-web', version: '2.1.0' },
    })
    const failure = new TypeError('bad cart')

    const root = som.tracer.startSpan('GET /cart/:id', {
      kind: 'client',
      attributes: {
        'http.request.method': 'GET',
        'http.response.status_code': 200,
        'cart.total': 12.5,
        'cart.express': true,
        'cart.blob': new Uint8Array([1, 2, 3]),
        'cart.tags': ['a', 'b'],
        'cart.owner': { name: 'Jo', age: 41 },
        'cart.note': 'héllo 🌍',
      },
    })
    root.addEvent('cache.miss', { 'cache.key': 'cart-42' })
    root.recordException(failure)
    root.setStatus({ code: 'error', message: 'upstream failed' })
    const child = som.tracer.startSpan('SELECT cart', {
      kind: 'client',
      parent: root,
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
    child.end()
    root.end()

    await som.flush()
    await collector.waitFor(
      (forwarded) => forwardedSpans(forwarded, service).length === 2,
    )

    expect(diagnostics).toEqual([])
    const spans = forwardedSpans(collector.forwarded, service)
    const forwardedRoot = spans.find(
      ({ item }) => item.name === 'GET /cart/:id',
    )
    const forwardedChild = spans.find(({ item }) => item.name === 'SELECT cart')
    const rootContext = root.spanContext()

    expect(forwardedRoot?.item).toMatchObject({
      traceId: rootContext.traceId,
      spanId: rootContext.spanId,
      kind: 3,
      flags: 1,
      status: { code: 2, message: 'upstream failed' },
      attributes: [
        { key: 'http.request.method', value: { stringValue: 'GET' } },
        { key: 'http.response.status_code', value: { intValue: '200' } },
        { key: 'cart.total', value: { doubleValue: 12.5 } },
        { key: 'cart.express', value: { boolValue: true } },
        { key: 'cart.blob', value: { bytesValue: 'AQID' } },
        {
          key: 'cart.tags',
          value: {
            arrayValue: {
              values: [{ stringValue: 'a' }, { stringValue: 'b' }],
            },
          },
        },
        {
          key: 'cart.owner',
          value: {
            kvlistValue: {
              values: [
                { key: 'name', value: { stringValue: 'Jo' } },
                { key: 'age', value: { intValue: '41' } },
              ],
            },
          },
        },
        { key: 'cart.note', value: { stringValue: 'héllo 🌍' } },
      ],
    })
    expect(forwardedRoot?.item.events?.map((event) => event.name)).toEqual([
      'cache.miss',
      'exception',
    ])
    expect(forwardedRoot?.item.events?.[1]?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'exception.type', value: { stringValue: 'TypeError' } },
        { key: 'exception.message', value: { stringValue: 'bad cart' } },
      ]),
    )
    expect(forwardedChild?.item).toMatchObject({
      traceId: rootContext.traceId,
      parentSpanId: rootContext.spanId,
      links: [
        {
          traceId: 'cc'.repeat(16),
          spanId: 'dd'.repeat(8),
          attributes: [{ key: 'link.reason', value: { stringValue: 'retry' } }],
        },
      ],
    })
    expect(
      BigInt(forwardedRoot?.item.endTimeUnixNano ?? 0),
    ).toBeGreaterThanOrEqual(BigInt(forwardedRoot?.item.startTimeUnixNano ?? 1))
    expect(forwardedRoot?.resource.attributes).toEqual(
      expect.arrayContaining([
        { key: 'service.name', value: { stringValue: service } },
        { key: 'service.version', value: { stringValue: '1.2.3' } },
        { key: 'deployment.environment.name', value: { stringValue: 'test' } },
        { key: 'telemetry.sdk.name', value: { stringValue: 'som-otel' } },
        { key: 'telemetry.sdk.language', value: { stringValue: 'webjs' } },
      ]),
    )
  })

  it('accepts logs correlated with a span and forwards the trace fields', async () => {
    const service = 'collector-test-logs'
    const { som, diagnostics } = setup(service)
    const span = som.tracer.startSpan('checkout')
    const failure = new RangeError('out of range')

    const logged = [
      som.logger.info(
        'Charging card',
        { orderId: 'order-42', attempt: 2, amount: 12.5 },
        { span, eventName: 'checkout.charge' },
      ),
      som.logger.error(failure, { orderId: 'order-42' }),
    ]
    span.end()
    await som.flush()
    await Promise.all(logged)
    await collector.waitFor(
      (forwarded) => forwardedLogs(forwarded, service).length === 2,
    )

    expect(diagnostics).toEqual([])
    const { traceId, spanId } = span.spanContext()
    const [info, error] = forwardedLogs(collector.forwarded, service).map(
      ({ item }) => item,
    )
    expect(info).toMatchObject({
      severityNumber: 9,
      severityText: 'INFO',
      body: { stringValue: 'Charging card' },
      traceId,
      spanId,
      flags: 1,
      eventName: 'checkout.charge',
      attributes: [
        { key: 'orderId', value: { stringValue: 'order-42' } },
        { key: 'attempt', value: { intValue: '2' } },
        { key: 'amount', value: { doubleValue: 12.5 } },
      ],
    })
    expect(error).toMatchObject({
      severityNumber: 17,
      body: { stringValue: 'out of range' },
    })
    expect(error?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'exception.type', value: { stringValue: 'RangeError' } },
        { key: 'exception.message', value: { stringValue: 'out of range' } },
      ]),
    )
    expect(BigInt(info?.timeUnixNano ?? 0)).toBeGreaterThan(0n)
  })

  it('accepts gzip-compressed requests for both signals', async () => {
    const service = 'collector-test-gzip'
    const { som, diagnostics } = setup(service, { compression: 'gzip' })

    const logged = som.logger.warn('compressed log')
    som.tracer.startSpan('compressed span').end()
    await som.flush()
    await logged
    await collector.waitFor(
      (forwarded) =>
        forwardedLogs(forwarded, service).length === 1 &&
        forwardedSpans(forwarded, service).length === 1,
    )

    expect(diagnostics).toEqual([])
  })

  it('accepts many spans split over several batches', async () => {
    const service = 'collector-test-batches'
    const { som, diagnostics } = setup(service, { batch: { maxBatchSize: 25 } })

    for (let index = 0; index < 120; index++) {
      som.tracer.startSpan(`span ${index}`).end()
    }
    await som.flush()
    await collector.waitFor(
      (forwarded) => forwardedSpans(forwarded, service).length === 120,
    )

    expect(diagnostics).toEqual([])
  })

  it('does not forward spans that are not sampled', async () => {
    const service = 'collector-test-unsampled'
    const { som } = setup(service)

    som.tracer
      .startSpan('skipped', {
        parent: {
          traceId: 'ab'.repeat(16),
          spanId: 'cd'.repeat(8),
          traceFlags: 0,
        },
      })
      .end()
    som.tracer.startSpan('kept').end()
    await som.flush()
    await collector.waitFor(
      (forwarded) => forwardedSpans(forwarded, service).length >= 1,
    )

    expect(
      forwardedSpans(collector.forwarded, service).map(({ item }) => item.name),
    ).toEqual(['kept'])
  })

  it('does not lose a batch because of a malformed trace id', async () => {
    const service = 'collector-test-malformed'
    const { som, diagnostics } = setup(service)

    const logged = [
      som.logger.info('bad ids', {}, { traceId: 'xyz', spanId: 'q' }),
      som.logger.info('good'),
    ]
    som.tracer
      .startSpan('linked', {
        parent: { traceId: 'xyz', spanId: 'q' },
        links: [{ context: { traceId: 'zz', spanId: 'yy' } }],
      })
      .end()
    await som.flush()
    await Promise.all(logged)
    await collector.waitFor(
      (forwarded) =>
        forwardedLogs(forwarded, service).length === 2 &&
        forwardedSpans(forwarded, service).length === 1,
    )

    expect(diagnostics).toEqual([])
    expect(
      forwardedSpans(collector.forwarded, service)[0]?.item.links,
    ).toBeUndefined()
  })

  it('reports a wrong endpoint as a failed export', async () => {
    const { som, diagnostics } = setup('collector-test-404', {
      endpoint: `${collector.url}/v1/not-a-path`,
      tracesEndpoint: `${collector.url}/v1/not-a-path`,
    })

    som.tracer.startSpan('lost').end()
    const failure = await som.flush().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OtlpExportError)
    expect(failure).toMatchObject({ status: 404, retryable: false })
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ type: 'export-failed', signal: 'traces' }),
    )
  })
})
