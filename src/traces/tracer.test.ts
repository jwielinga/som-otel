import { describe, expect, it } from 'vitest'
import { setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

describe('createSom tracer', () => {
  it('delivers an ended root span to the derived traces endpoint', async () => {
    const { som, collector } = setup({ serviceVersion: '1.2.3' })

    som.tracer.startSpan('GET /cart').end()
    await som.flush()

    expect(collector.requests).toHaveLength(1)
    const request = collector.requests[0]
    expect(request?.url).toBe('https://collector.example/v1/traces')
    expect(request?.headers['content-type']).toBe('application/json')
    expect(request?.payload.resourceSpans[0]).toMatchObject({
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'checkout' } },
          { key: 'service.version', value: { stringValue: '1.2.3' } },
        ],
      },
      scopeSpans: [{ scope: { name: 'som' } }],
    })

    const [span] = collector.spans
    expect(collector.spans).toHaveLength(1)
    expect(span).toMatchObject({
      name: 'GET /cart',
      kind: 1,
      flags: 1,
    })
    expect(span?.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(span?.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(span?.traceId).not.toBe('0'.repeat(32))
    expect(span?.spanId).not.toBe('0'.repeat(16))
    expect(span).not.toHaveProperty('parentSpanId')
    expect(span?.startTimeUnixNano).toMatch(/^\d{19}$/)
    expect(span?.endTimeUnixNano).toMatch(/^\d{19}$/)
    expect(BigInt(span?.endTimeUnixNano ?? 0)).toBeGreaterThanOrEqual(
      BigInt(span?.startTimeUnixNano ?? 0),
    )
  })
})

describe('traces endpoint', () => {
  it.each([
    [
      'https://collector.example/v1/logs',
      'https://collector.example/v1/traces',
    ],
    [
      'https://collector.example/v1/logs/',
      'https://collector.example/v1/traces/',
    ],
    ['/v1/logs?token=abc', '/v1/traces?token=abc'],
    ['https://logs.example/ingest/logs', 'https://logs.example/ingest/traces'],
  ])('derives %s to %s', async (endpoint, expected) => {
    const { som, collector } = setup({ endpoint })

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests[0]?.url).toBe(expected)
  })

  it('prefers an explicit tracesEndpoint', async () => {
    const { som, collector } = setup({
      endpoint: 'https://collector.example/ingest',
      tracesEndpoint: 'https://tempo.example/otlp/spans',
    })

    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests[0]?.url).toBe('https://tempo.example/otlp/spans')
  })

  it('requires tracesEndpoint when the logs endpoint cannot be mapped', () => {
    expect(() =>
      setup({ endpoint: 'https://collector.example/ingest' }),
    ).toThrow('tracesEndpoint is required')
  })

  it('rejects a blank tracesEndpoint', () => {
    expect(() => setup({ tracesEndpoint: '  ' })).toThrow(
      'tracesEndpoint must be a non-empty string.',
    )
  })

  it('sends logs to endpoint and spans to the traces endpoint', async () => {
    const { som, collector } = setup()

    await som.logger.info('hello')
    som.tracer.startSpan('x').end()
    await som.flush()

    expect(collector.requests.map((request) => request.url).sort()).toEqual([
      'https://collector.example/v1/logs',
      'https://collector.example/v1/traces',
    ])
    expect(collector.bodies).toEqual(['hello'])
    expect(collector.spans).toHaveLength(1)
  })
})
