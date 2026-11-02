import { describe, expect, it } from 'vitest'
import { resolveTracesEndpoint } from './traces-endpoint.js'

describe('resolveTracesEndpoint', () => {
  it.each([
    ['https://c.example/v1/logs', 'https://c.example/v1/traces'],
    ['https://c.example/v1/logs/', 'https://c.example/v1/traces/'],
    ['/v1/logs', '/v1/traces'],
    ['/v1/logs?token=abc', '/v1/traces?token=abc'],
    ['/v1/logs#frag', '/v1/traces#frag'],
    ['https://c.example/logs/v1/logs', 'https://c.example/logs/v1/traces'],
  ])('derives %s to %s', (logs, traces) => {
    expect(resolveTracesEndpoint(logs)).toBe(traces)
  })

  it('prefers an explicit traces endpoint', () => {
    expect(
      resolveTracesEndpoint('https://c.example/ingest', 'https://t.example/x'),
    ).toBe('https://t.example/x')
  })

  it.each([
    'https://c.example/ingest',
    'https://c.example/logs/extra',
    '/logs.json',
  ])('throws when %s cannot be mapped', (logs) => {
    expect(() => resolveTracesEndpoint(logs)).toThrow(
      'tracesEndpoint is required when endpoint does not end in "/logs".',
    )
  })

  it('throws for a blank explicit endpoint', () => {
    expect(() => resolveTracesEndpoint('/v1/logs', '  ')).toThrow(
      'tracesEndpoint must be a non-empty string.',
    )
  })
})
