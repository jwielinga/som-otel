import { describe, expect, it } from 'vitest'
import { resolveSignalEndpoint } from './signal-endpoint.js'

describe('resolveSignalEndpoint', () => {
  it.each([
    ['https://c.example/v1/logs', 'https://c.example/v1/traces'],
    ['https://c.example/v1/logs/', 'https://c.example/v1/traces/'],
    ['/v1/logs', '/v1/traces'],
    ['/v1/logs?token=abc', '/v1/traces?token=abc'],
    ['/v1/logs#frag', '/v1/traces#frag'],
    ['https://c.example/logs/v1/logs', 'https://c.example/logs/v1/traces'],
  ])('derives the traces endpoint from %s to %s', (logs, traces) => {
    expect(resolveSignalEndpoint('traces', logs)).toBe(traces)
  })

  it.each([
    ['https://c.example/v1/logs', 'https://c.example/v1/metrics'],
    ['/v1/logs?token=abc', '/v1/metrics?token=abc'],
    ['https://c.example/logs/v1/logs', 'https://c.example/logs/v1/metrics'],
  ])('derives the metrics endpoint from %s to %s', (logs, metrics) => {
    expect(resolveSignalEndpoint('metrics', logs)).toBe(metrics)
  })

  it('prefers an explicit endpoint', () => {
    expect(
      resolveSignalEndpoint(
        'traces',
        'https://c.example/ingest',
        'https://t.example/x',
      ),
    ).toBe('https://t.example/x')
    expect(
      resolveSignalEndpoint(
        'metrics',
        'https://c.example/ingest',
        'https://m.example/x',
      ),
    ).toBe('https://m.example/x')
  })

  it.each([
    'https://c.example/ingest',
    'https://c.example/logs/extra',
    '/logs.json',
  ])('throws when %s cannot be mapped', (logs) => {
    expect(() => resolveSignalEndpoint('traces', logs)).toThrow(
      'tracesEndpoint is required when endpoint does not end in "/logs".',
    )
    expect(() => resolveSignalEndpoint('metrics', logs)).toThrow(
      'metricsEndpoint is required when endpoint does not end in "/logs".',
    )
  })

  it('throws for a blank explicit endpoint', () => {
    expect(() => resolveSignalEndpoint('traces', '/v1/logs', '  ')).toThrow(
      'tracesEndpoint must be a non-empty string.',
    )
    expect(() => resolveSignalEndpoint('metrics', '/v1/logs', '  ')).toThrow(
      'metricsEndpoint must be a non-empty string.',
    )
  })
})
