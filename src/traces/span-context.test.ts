import { describe, expect, it } from 'vitest'
import { resolveSpanContext } from './span-context.js'
import { Span } from './span.js'
import { OTelSpanKind } from '../otlp/otlp.constants.js'

const traceId = '5b8efff798038103d269b633813fc60c'
const spanId = 'eee19b7ec3c1b174'

function spanWithFlags(traceFlags: number): Span {
  return new Span({
    name: 'parent',
    kind: OTelSpanKind.INTERNAL,
    context: { traceId, spanId, traceFlags },
    startTimeUnixNano: 0n,
    onEnd: () => undefined,
  })
}

describe('resolveSpanContext', () => {
  it('starts a sampled root trace without a parent', () => {
    const { context, parentSpanId, sampled } = resolveSpanContext(undefined)

    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(context.traceFlags).toBe(1)
    expect(parentSpanId).toBeUndefined()
    expect(sampled).toBe(true)
  })

  it('continues the trace of a trace context', () => {
    const resolved = resolveSpanContext({ traceId, spanId, traceFlags: 1 })

    expect(resolved.context.traceId).toBe(traceId)
    expect(resolved.context.spanId).not.toBe(spanId)
    expect(resolved.parentSpanId).toBe(spanId)
    expect(resolved.sampled).toBe(true)
  })

  it('continues the trace of a span', () => {
    const resolved = resolveSpanContext(spanWithFlags(1))

    expect(resolved.context.traceId).toBe(traceId)
    expect(resolved.parentSpanId).toBe(spanId)
  })

  it('treats a parent without flags as sampled', () => {
    const resolved = resolveSpanContext({ traceId, spanId })

    expect(resolved.context.traceFlags).toBe(1)
    expect(resolved.sampled).toBe(true)
  })

  it('is not sampled when the parent sampled bit is unset', () => {
    const resolved = resolveSpanContext({ traceId, spanId, traceFlags: 0 })

    expect(resolved.context.traceFlags).toBe(0)
    expect(resolved.sampled).toBe(false)
  })

  it('keeps only the low 8 bits of the parent flags', () => {
    const resolved = resolveSpanContext({ traceId, spanId, traceFlags: 0x103 })

    expect(resolved.context.traceFlags).toBe(3)
    expect(resolved.sampled).toBe(true)
  })

  it('lowercases the ids of the parent', () => {
    const resolved = resolveSpanContext({
      traceId: traceId.toUpperCase(),
      spanId: spanId.toUpperCase(),
    })

    expect(resolved.context.traceId).toBe(traceId)
    expect(resolved.parentSpanId).toBe(spanId)
  })

  it.each([
    ['a short trace id', { traceId: 'abc', spanId }],
    ['a short span id', { traceId, spanId: 'abc' }],
    ['non-hex ids', { traceId: 'z'.repeat(32), spanId: 'z'.repeat(16) }],
    ['an all-zero trace id', { traceId: '0'.repeat(32), spanId }],
    ['an all-zero span id', { traceId, spanId: '0'.repeat(16) }],
  ])(
    'ignores a parent with %s and starts a new sampled trace',
    (_name, parent) => {
      const resolved = resolveSpanContext({ ...parent, traceFlags: 0 })

      expect(resolved.context.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(resolved.context.traceId).not.toBe(parent.traceId)
      expect(resolved.parentSpanId).toBeUndefined()
      expect(resolved.context.traceFlags).toBe(1)
      expect(resolved.sampled).toBe(true)
    },
  )
})
