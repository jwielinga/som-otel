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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const retryableFailures: Array<[string, Script]> = [
  ['HTTP 503', 503],
  ['HTTP 429', 429],
  ['a network error', new TypeError('Failed to fetch')],
]

describe('span export retries', () => {
  it.each(retryableFailures)(
    'retries after %s and delivers the same batch',
    async (_name, failure) => {
      const { som, collector } = setup()
      collector.enqueue(failure, 204)

      som.tracer.startSpan('checkout').end()
      await som.flush()

      expect(collector.requests).toHaveLength(2)
      expect(collector.requests[1]?.payload).toEqual(
        collector.requests[0]?.payload,
      )
      expect(collector.spans.map((span) => span.name)).toEqual([
        'checkout',
        'checkout',
      ])
    },
  )

  it('honors Retry-After', async () => {
    const { som, collector } = setup()
    collector.enqueue(statusResponse(429, { 'Retry-After': '0' }), 204)

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests).toHaveLength(2)
  })

  it('does not retry a non-retryable status and rejects flush', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      onDiagnostic: (event) => events.push(event),
    })
    collector.setFallback(400)

    som.tracer.startSpan('x').end()
    const failure = await som.flush().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OtlpExportError)
    expect(failure).toMatchObject({
      message: 'OTLP trace request failed: 400',
      status: 400,
      retryable: false,
    })
    expect(collector.requests).toHaveLength(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'export-failed',
        signal: 'traces',
        recordCount: 1,
      }),
    )
  })

  it('stops after the configured attempts', async () => {
    const { som, collector } = setup({ retry: { maxAttempts: 2 } })
    collector.setFallback(503)

    som.tracer.startSpan('x').end()
    await expect(som.flush()).rejects.toThrow('503')

    expect(collector.requests).toHaveLength(2)
  })

  it('makes a single attempt when retry is disabled', async () => {
    const { som, collector } = setup({ retry: false })
    collector.setFallback(503)

    som.tracer.startSpan('x').end()
    await expect(som.flush()).rejects.toThrow('503')

    expect(collector.requests).toHaveLength(1)
  })
})

describe('span export timeout', () => {
  it('aborts a hanging request and reports the timeout', async () => {
    const { som, collector } = setup({ timeoutMs: 20, retry: false })
    collector.setFallback('hang')

    som.tracer.startSpan('x').end()

    await expect(som.flush()).rejects.toThrow(
      'OTLP trace request timed out after 20ms',
    )
    expect(collector.requests[0]?.signal?.aborted).toBe(true)
  })
})

describe('span export transport', () => {
  it('compresses the request with gzip', async () => {
    const { som, collector } = setup({ compression: 'gzip' })

    som.tracer.startSpan('squeezed').end()
    await som.flush()

    expect(collector.requests[0]?.compressed).toBe(true)
    expect(collector.requests[0]?.headers['content-encoding']).toBe('gzip')
    expect(collector.spans.map((span) => span.name)).toEqual(['squeezed'])
  })

  it('sends configured headers with a JSON content type', async () => {
    const { som, collector } = setup({
      headers: { Authorization: 'Bearer token' },
    })

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests[0]?.headers).toMatchObject({
      authorization: 'Bearer token',
      'content-type': 'application/json',
    })
  })

  it('uses fetch keepalive when the browser supports it', async () => {
    stubPage({ keepaliveSupported: true })
    const { som, collector } = setup()

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests[0]?.keepalive).toBe(true)
  })

  it('skips keepalive when it is turned off', async () => {
    stubPage({ keepaliveSupported: true })
    const { som, collector } = setup({ keepalive: false })

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests[0]?.keepalive).toBe(false)
  })

  it('applies resource and scope settings to the traces request', async () => {
    const { som, collector } = setup({
      scope: { name: 'storefront', version: '2.0.0', schemaUrl: 'https://s/1' },
      resourceSchemaUrl: 'https://r/1',
      resourceAttributes: { 'deployment.environment.name': 'test' },
    })

    som.tracer.startSpan('x').end()
    await som.flush()

    const resourceSpans = collector.requests[0]?.payload.resourceSpans[0]
    expect(resourceSpans?.schemaUrl).toBe('https://r/1')
    expect(resourceSpans?.scopeSpans[0]?.schemaUrl).toBe('https://s/1')
    expect(resourceSpans?.scopeSpans[0]?.scope).toEqual({
      name: 'storefront',
      version: '2.0.0',
    })
    expect(resourceSpans?.resource.attributes).toContainEqual({
      key: 'deployment.environment.name',
      value: { stringValue: 'test' },
    })
  })
})

describe('span partial success', () => {
  it('reports rejected spans without failing or retrying', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      onDiagnostic: (event) => events.push(event),
    })
    collector.enqueue(
      jsonResponse({
        partialSuccess: { rejectedSpans: '2', errorMessage: 'bad span' },
      }),
    )

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests).toHaveLength(1)
    expect(events).toEqual([
      {
        type: 'partial-success',
        signal: 'traces',
        rejectedSpans: 2,
        errorMessage: 'bad span',
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

    for (const name of ['a', 'b', 'c']) som.tracer.startSpan(name).end()
    await som.flush()

    expect(events).toEqual([])
  })

  it('survives a throwing diagnostics callback', async () => {
    const { som, collector } = setup({
      onDiagnostic: () => {
        throw new Error('callback bug')
      },
    })
    collector.enqueue(jsonResponse({ partialSuccess: { rejectedSpans: '1' } }))

    som.tracer.startSpan('x').end()

    await expect(som.flush()).resolves.toBeUndefined()
    expect(collector.requests).toHaveLength(1)
  })
})

describe('diagnostics per signal', () => {
  it('tags log events with the logs signal', async () => {
    const events: SomDiagnosticEvent[] = []
    const { som, collector } = setup({
      retry: false,
      onDiagnostic: (event) => events.push(event),
    })
    collector.setFallback(500)

    await som.logger.info('x').catch(() => undefined)

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'export-failed', signal: 'logs' }),
    )
  })

  it('rejects som.flush with both failures when logs and spans fail', async () => {
    const { som, collector } = setup({
      retry: false,
      batch: { maxBatchSize: 10, scheduledDelayMs: 60_000 },
    })
    collector.setFallback(500)

    const logged = som.logger.info('x').catch(() => undefined)
    som.tracer.startSpan('x').end()
    const failure = await som.flush().catch((error: unknown) => error)
    await logged

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(2)
  })

  it('rejects som.flush with the single failure when only spans fail', async () => {
    const { som, collector } = setup({ retry: false })
    collector.enqueue(500)

    som.tracer.startSpan('x').end()
    await expect(som.flush()).rejects.toBeInstanceOf(OtlpExportError)
    await som.logger.info('still fine')

    expect(collector.bodies).toEqual(['still fine'])
  })
})
