import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowUnixNano } from '../utils/clock.js'
import type { OTelAnyValue } from '../types.js'
import {
  createOtlpLogRecord,
  createOtlpLogsRequest,
  encodeOtlpLogRecord,
  resolveLimits,
} from '../otlp/encode-logs.js'
import { DEFAULT_LIMITS } from '../otlp/otlp.constants.js'

afterEach(() => {
  vi.useRealTimers()
})

function limits(overrides: Parameters<typeof resolveLimits>[0]) {
  return resolveLimits(overrides)
}

describe('attribute limits', () => {
  it('drops attributes beyond the count limit and counts them', () => {
    const record = createOtlpLogRecord(
      'info',
      'x',
      { a: 1, b: 2, c: 3 },
      {},
      limits({ attributeCountLimit: 2 }),
    )

    expect(record.attributes?.map(({ key }) => key)).toEqual(['a', 'b'])
    expect(record.droppedAttributesCount).toBe(1)
  })

  it('adds dropped attributes to a caller-supplied dropped count', () => {
    const record = encodeOtlpLogRecord(
      { attributes: { a: 1, b: 2 }, droppedAttributesCount: 4 },
      limits({ attributeCountLimit: 1 }),
    )

    expect(record.droppedAttributesCount).toBe(5)
  })

  it('has default limits of 128 attributes and unlimited string length', () => {
    const attributes = Object.fromEntries(
      Array.from({ length: 130 }, (_, index) => [`k${index}`, index]),
    )

    const record = createOtlpLogRecord('info', 'x', attributes)

    expect(record.attributes).toHaveLength(128)
    expect(record.droppedAttributesCount).toBe(2)
    expect(DEFAULT_LIMITS.attributeValueLengthLimit).toBe(Infinity)
  })

  it('truncates string attributes but not the body', () => {
    const record = createOtlpLogRecord(
      'info',
      'long body',
      { text: 'abcdef', list: ['abcdef'], nested: { inner: 'abcdef' } },
      {},
      limits({ attributeValueLengthLimit: 3 }),
    )

    expect(record.body).toEqual({ stringValue: 'long body' })
    expect(JSON.stringify(record.attributes)).not.toContain('abcd')
    expect(record.attributes?.[0]?.value).toEqual({ stringValue: 'abc' })
  })

  it('does not split a surrogate pair when truncating', () => {
    const record = createOtlpLogRecord(
      'info',
      'x',
      { emoji: '\u{1F600}' },
      {},
      limits({ attributeValueLengthLimit: 1 }),
    )

    expect(record.attributes?.[0]?.value).toEqual({ stringValue: '' })
  })
})

describe('nested value guards', () => {
  it('replaces circular references instead of overflowing the stack', () => {
    const loop: Record<string, OTelAnyValue> = { name: 'loop' }
    loop.self = loop

    const record = createOtlpLogRecord('info', 'x', { loop })

    expect(record.attributes?.[0]?.value?.kvlistValue?.values?.[1]).toEqual({
      key: 'self',
      value: { stringValue: '[Circular]' },
    })
  })

  it('allows the same object to appear in sibling positions', () => {
    const shared = { a: 1 }

    const record = createOtlpLogRecord('info', 'x', {
      shared: [shared, shared],
    })

    expect(JSON.stringify(record.attributes)).not.toContain('[Circular]')
  })

  it('replaces values nested deeper than maxValueDepth', () => {
    const record = createOtlpLogRecord(
      'info',
      'x',
      { x: { b: { c: { d: 1 } } } },
      {},
      limits({ maxValueDepth: 2 }),
    )

    const c =
      record.attributes?.[0]?.value?.kvlistValue?.values?.[0]?.value
        ?.kvlistValue?.values?.[0]
    expect(c).toEqual({
      key: 'c',
      value: { stringValue: '[MaxDepthExceeded]' },
    })
  })
})

describe('Error serialization', () => {
  it('maps an Error body to message plus exception attributes', () => {
    const record = createOtlpLogRecord('error', new RangeError('boom'), {
      orderId: 'o1',
    })

    expect(record.body).toEqual({ stringValue: 'boom' })
    expect(record.attributes?.map(({ key }) => key)).toEqual([
      'exception.type',
      'exception.message',
      'exception.stacktrace',
      'orderId',
    ])
    expect(record.attributes?.[0]?.value).toEqual({ stringValue: 'RangeError' })
    expect(record.attributes?.[2]?.value?.stringValue).toContain('boom')
  })

  it('uses the constructor name for subclasses that keep name "Error"', () => {
    class PaymentError extends Error {}

    const record = createOtlpLogRecord(
      'error',
      new PaymentError('declined'),
      {},
    )

    expect(record.attributes?.[0]?.value).toEqual({
      stringValue: 'PaymentError',
    })
  })

  it('lets caller attributes override exception attributes', () => {
    const record = createOtlpLogRecord('error', new Error('boom'), {
      'exception.type': 'custom',
    })

    expect(
      record.attributes?.filter(({ key }) => key === 'exception.type'),
    ).toEqual([{ key: 'exception.type', value: { stringValue: 'custom' } }])
  })

  it('omits the stack trace when an error has none', () => {
    const error = new Error('no stack')
    error.stack = undefined

    const record = createOtlpLogRecord('error', error, {})

    expect(record.attributes?.map(({ key }) => key)).toEqual([
      'exception.type',
      'exception.message',
    ])
  })

  it('serializes an Error attribute as a map', () => {
    const record = createOtlpLogRecord('error', 'failed', {
      cause: new TypeError('bad input'),
    })

    const fields = record.attributes?.[0]?.value?.kvlistValue?.values

    expect(fields?.map(({ key }) => key)).toEqual([
      'type',
      'message',
      'stacktrace',
    ])
    expect(fields?.[0]?.value).toEqual({ stringValue: 'TypeError' })
  })
})

describe('record extras', () => {
  it('sets observed time equal to time and carries correlation fields', () => {
    const record = createOtlpLogRecord(
      'info',
      'x',
      {},
      {
        traceId: '5b8efff798038103d269b633813fc60c',
        spanId: 'eee19b7ec3c1b174',
        flags: 1,
        eventName: 'checkout.done',
      },
    )

    expect(record.observedTimeUnixNano).toBe(record.timeUnixNano)
    expect(record).toMatchObject({
      traceId: '5b8efff798038103d269b633813fc60c',
      spanId: 'eee19b7ec3c1b174',
      flags: 1,
      eventName: 'checkout.done',
    })
  })
})

describe('createOtlpLogsRequest scope and schema', () => {
  it('uses the configured scope and schema URLs', () => {
    const request = createOtlpLogsRequest({}, [], {
      scope: {
        name: 'web',
        version: '1.2',
        attributes: { area: 'checkout' },
        schemaUrl: 'https://opentelemetry.io/schemas/1.27.0',
      },
      resourceSchemaUrl: 'https://opentelemetry.io/schemas/1.26.0',
    })

    expect(request).toEqual({
      resourceLogs: [
        {
          resource: { attributes: [] },
          schemaUrl: 'https://opentelemetry.io/schemas/1.26.0',
          scopeLogs: [
            {
              scope: {
                name: 'web',
                version: '1.2',
                attributes: [
                  { key: 'area', value: { stringValue: 'checkout' } },
                ],
              },
              schemaUrl: 'https://opentelemetry.io/schemas/1.27.0',
              logRecords: [],
            },
          ],
        },
      ],
    })
  })

  it('omits schema URLs by default', () => {
    expect(JSON.stringify(createOtlpLogsRequest({}, []))).not.toContain(
      'schemaUrl',
    )
  })
})

describe('nowUnixNano', () => {
  it('tracks the wall clock within a second', () => {
    const before = BigInt(Date.now()) * 1_000_000n
    const now = nowUnixNano()
    const after = BigInt(Date.now()) * 1_000_000n

    expect(now).toBeGreaterThanOrEqual(before - 1_000_000_000n)
    expect(now).toBeLessThanOrEqual(after + 1_000_000_000n)
  })

  it('resyncs to the system clock when it jumps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))

    expect(nowUnixNano()).toBe(1_893_456_000_000_000_000n)
  })
})
