import { afterEach, describe, expect, it, vi } from 'vitest'
import { OtlpExportError } from '../transport/http-exporter.js'
import type { SomDiagnosticEvent } from '../types.js'
import {
  jsonResponse,
  statusResponse,
  type Script,
} from '../test-support/fake-collector.js'
import { stubPage } from '../test-support/page.js'
import { setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const slowBatch = { maxBatchSize: 10, scheduledDelayMs: 60_000 }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const retryableFailures: Array<[string, Script]> = [
  ['HTTP 503', 503],
  ['HTTP 429', 429],
  ['a network error', new TypeError('Failed to fetch')],
]

describe('metric export retries', () => {
  it.each(retryableFailures)(
    'retries after %s and delivers the same batch',
    async (_name, failure) => {
      const { som, collector } = setup()
      collector.enqueue(failure, 204)

      som.meter.createCounter('checkout.clicks').add(1)
      await som.flush()

      expect(collector.requests).toHaveLength(2)
      expect(collector.requests[1]?.payload).toEqual(
        collector.requests[0]?.payload,
      )
    },
  )

  it('honors Retry-After', async () => {
    const { som, collector } = setup()
    collector.enqueue(statusResponse(429, { 'Retry-After': '0' }), 204)

    som.meter.createCounter('x').add(1)
    await som.flush()

    expect(collector.requests).toHaveLength(2)
  })

  it('does not retry a non-retryable status and rejects flush', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      onDiagnostic: (event) => events.push(event),
    })
    collector.setFallback(400)

    som.meter.createCounter('x').add(1)
    const failure = await som.flush().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OtlpExportError)
    expect(failure).toMatchObject({
      message: 'OTLP metric request failed: 400',
      status: 400,
      retryable: false,
    })
    expect(collector.requests).toHaveLength(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'export-failed',
        signal: 'metrics',
        recordCount: 1,
      }),
    )
  })

  it('stops after the configured attempts', async () => {
    const { som, collector } = setup({ retry: { maxAttempts: 2 } })
    collector.setFallback(503)

    som.meter.createCounter('x').add(1)
    await expect(som.flush()).rejects.toThrow('503')

    expect(collector.requests).toHaveLength(2)
  })

  it('makes a single attempt when retry is disabled', async () => {
    const { som, collector } = setup({ retry: false })
    collector.setFallback(503)

    som.meter.createCounter('x').add(1)
    await expect(som.flush()).rejects.toThrow('503')

    expect(collector.requests).toHaveLength(1)
  })

  it('aborts a hanging request and reports the timeout', async () => {
    const { som, collector } = setup({ timeoutMs: 20, retry: false })
    collector.setFallback('hang')

    som.meter.createCounter('x').add(1)

    await expect(som.flush()).rejects.toThrow(
      'OTLP metric request timed out after 20ms',
    )
    expect(collector.requests[0]?.signal?.aborted).toBe(true)
  })
})

describe('metric export transport', () => {
  it('compresses the request with gzip', async () => {
    const { som, collector } = setup({ compression: 'gzip' })

    som.meter.createCounter('squeezed').add(1)
    await som.flush()

    expect(collector.requests[0]?.compressed).toBe(true)
    expect(collector.requests[0]?.headers['content-encoding']).toBe('gzip')
    expect(collector.metrics.map((metric) => metric.name)).toEqual(['squeezed'])
  })

  it('sends configured headers with a JSON content type', async () => {
    const { som, collector } = setup({
      headers: { Authorization: 'Bearer token' },
    })

    som.meter.createCounter('x').add(1)
    await som.flush()

    expect(collector.requests[0]?.headers).toMatchObject({
      authorization: 'Bearer token',
      'content-type': 'application/json',
    })
  })

  it('uses fetch keepalive when the browser supports it', async () => {
    stubPage({ keepaliveSupported: true })
    const { som, collector } = setup()

    som.meter.createCounter('x').add(1)
    await som.flush()

    expect(collector.requests[0]?.keepalive).toBe(true)
  })

  it('applies resource and scope settings to the metrics request', async () => {
    const { som, collector } = setup({
      scope: { name: 'storefront', version: '2.0.0', schemaUrl: 'https://s/1' },
      resourceSchemaUrl: 'https://r/1',
    })

    som.meter.createCounter('x').add(1)
    await som.flush()

    const resourceMetrics = collector.requests[0]?.payload.resourceMetrics[0]
    expect(resourceMetrics?.schemaUrl).toBe('https://r/1')
    expect(resourceMetrics?.scopeMetrics[0]?.schemaUrl).toBe('https://s/1')
    expect(resourceMetrics?.scopeMetrics[0]?.scope).toEqual({
      name: 'storefront',
      version: '2.0.0',
    })
  })
})

describe('metric partial success', () => {
  it('reports rejected data points without failing or retrying', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      onDiagnostic: (event) => events.push(event),
    })
    collector.enqueue(
      jsonResponse({
        partialSuccess: { rejectedDataPoints: '2', errorMessage: 'bad point' },
      }),
    )

    som.meter.createCounter('x').add(1)
    await som.flush()

    expect(collector.requests).toHaveLength(1)
    expect(events).toEqual([
      {
        type: 'partial-success',
        signal: 'metrics',
        rejectedDataPoints: 2,
        errorMessage: 'bad point',
      },
    ])
  })

  it('stays quiet for a plain success response', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      onDiagnostic: (event) => events.push(event),
    })
    collector.enqueue(
      jsonResponse({}),
      jsonResponse({ partialSuccess: {} }),
      204,
    )

    for (const name of ['a', 'b', 'c']) som.meter.createCounter(name).add(1)
    await som.flush()

    expect(events).toEqual([])
  })

  it('survives a throwing diagnostics callback', async () => {
    const { som, collector } = setup({
      onDiagnostic: () => {
        throw new Error('callback bug')
      },
    })
    collector.enqueue(
      jsonResponse({ partialSuccess: { rejectedDataPoints: '1' } }),
    )

    som.meter.createCounter('x').add(1)

    await expect(som.flush()).resolves.toBeUndefined()
  })
})

describe('metric queue overflow', () => {
  it('drops the new measurement by default and reports it', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      batch: { maxBatchSize: 1, maxQueueSize: 1 },
      onDiagnostic: (event) => events.push(event),
    })
    const release = collector.hold()
    const clicks = som.meter.createCounter('clicks')

    clicks.add(1)
    clicks.add(10)
    clicks.add(100)
    release()
    await som.flush()

    expect(som.meter.droppedMeasurementCount).toBe(1)
    expect(events).toContainEqual({
      type: 'records-dropped',
      signal: 'metrics',
      reason: 'queue-full',
      totalDropped: 1,
    })
    const sent = collector.metrics.flatMap((metric) =>
      (metric.sum?.dataPoints ?? []).map((point) => point.asInt),
    )
    expect(sent).toEqual(['1', '10'])
  })

  it('evicts the oldest queued measurement with drop-oldest', async () => {
    const { som, collector } = setup({
      batch: {
        maxBatchSize: 1,
        maxQueueSize: 1,
        overflowStrategy: 'drop-oldest',
      },
    })
    const release = collector.hold()
    const clicks = som.meter.createCounter('clicks')

    clicks.add(1)
    clicks.add(10)
    clicks.add(100)
    release()
    await som.flush()

    const sent = collector.metrics.flatMap((metric) =>
      (metric.sum?.dataPoints ?? []).map((point) => point.asInt),
    )
    expect(sent).toEqual(['1', '100'])
    expect(som.meter.droppedMeasurementCount).toBe(1)
  })
})

describe('metric page hide flush', () => {
  it('sends queued measurements synchronously with keepalive', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const { som, collector } = setup({ batch: slowBatch })

    som.meter.createCounter('last').add(1)
    page.pagehide()

    expect(collector.requests).toHaveLength(1)
    expect(collector.requests[0]).toMatchObject({
      url: 'https://collector.example/v1/metrics',
      keepalive: true,
      compressed: false,
    })
    await som.flush()
    expect(collector.metrics.map((metric) => metric.name)).toEqual(['last'])
  })

  it('flushes when the page becomes hidden', async () => {
    const page = stubPage({ keepaliveSupported: true })
    const { som, collector } = setup({ batch: slowBatch })

    som.meter.createCounter('tab').add(1)
    page.setVisibility('visible')
    expect(collector.requests).toHaveLength(0)

    page.setVisibility('hidden')
    expect(collector.metrics.map((metric) => metric.name)).toEqual(['tab'])
    await som.flush()
  })
})

describe('metrics next to the other signals', () => {
  it('rejects som.flush with every failure when all three signals fail', async () => {
    const { som, collector } = setup({ retry: false, batch: slowBatch })
    collector.setFallback(500)

    const logged = som.logger.info('x').catch(() => undefined)
    som.tracer.startSpan('x').end()
    som.meter.createCounter('x').add(1)
    const failure = await som.flush().catch((error: unknown) => error)
    await logged

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(3)
  })

  it('shuts the meter down on its own', async () => {
    const { som, collector } = setup({ batch: slowBatch })

    som.meter.createCounter('pending').add(1)
    await som.meter.shutdown()

    expect(collector.metrics.map((metric) => metric.name)).toEqual(['pending'])
    const stillOpen = som.logger.info('still open')
    await som.logger.flush()
    await expect(stillOpen).resolves.toBeUndefined()
  })
})
