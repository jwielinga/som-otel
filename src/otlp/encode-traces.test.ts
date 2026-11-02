import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS } from './otlp.constants.js'
import {
  createOtlpTracesRequest,
  encodeOtlpSpan,
  encodeSpanLink,
  encodeSpanStatus,
} from './encode-traces.js'
import type { SpanData } from '../types.js'

const base: SpanData = {
  name: 'GET /cart',
  kind: 3,
  context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 },
  parentSpanId: undefined,
  startTimeUnixNano: 1767225600000000000n,
  endTimeUnixNano: 1767225600500000000n,
  attributes: {},
  droppedAttributesCount: 0,
  events: [],
  droppedEventsCount: 0,
  links: [],
  droppedLinksCount: 0,
  status: undefined,
}

describe('encodeOtlpSpan', () => {
  it('encodes ids, flags, kind, and nano timestamps as strings', () => {
    expect(encodeOtlpSpan(base)).toEqual({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      flags: 1,
      name: 'GET /cart',
      kind: 3,
      startTimeUnixNano: '1767225600000000000',
      endTimeUnixNano: '1767225600500000000',
    })
  })

  it('serializes without empty lists or zero dropped counts', () => {
    const json = JSON.parse(JSON.stringify(encodeOtlpSpan(base))) as object

    expect(Object.keys(json).sort()).toEqual([
      'endTimeUnixNano',
      'flags',
      'kind',
      'name',
      'spanId',
      'startTimeUnixNano',
      'traceId',
    ])
  })

  it('adds the parent span id and the dropped counts when set', () => {
    const encoded = encodeOtlpSpan({
      ...base,
      parentSpanId: 'c'.repeat(16),
      attributes: { a: 1 },
      droppedAttributesCount: 2,
      droppedEventsCount: 3,
      droppedLinksCount: 4,
    })

    expect(encoded).toMatchObject({
      parentSpanId: 'c'.repeat(16),
      droppedAttributesCount: 2,
      droppedEventsCount: 3,
      droppedLinksCount: 4,
    })
  })

  it('adds attributes dropped at encode time to the ones dropped on the span', () => {
    const encoded = encodeOtlpSpan(
      { ...base, attributes: { a: 1, b: 2, c: 3 }, droppedAttributesCount: 1 },
      { ...DEFAULT_LIMITS, attributeCountLimit: 2 },
    )

    expect(encoded.attributes).toHaveLength(2)
    expect(encoded.droppedAttributesCount).toBe(2)
  })
})

describe('encodeSpanStatus', () => {
  it('omits an unset status', () => {
    expect(encodeSpanStatus(undefined)).toBeUndefined()
  })

  it('encodes ok without a message', () => {
    expect(encodeSpanStatus({ code: 'ok', message: 'ignored' })).toEqual({
      code: 1,
    })
  })

  it('encodes error with its message, or without when empty', () => {
    expect(encodeSpanStatus({ code: 'error', message: 'boom' })).toEqual({
      code: 2,
      message: 'boom',
    })
    expect(encodeSpanStatus({ code: 'error', message: '' })).toEqual({
      code: 2,
    })
  })
})

describe('encodeSpanLink', () => {
  it('keeps only the low 8 bits of the trace flags', () => {
    const link = encodeSpanLink(
      {
        context: {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          traceFlags: 0x101,
        },
      },
      DEFAULT_LIMITS,
    )

    expect(link.flags).toBe(1)
  })

  it('leaves flags unset when the context has none', () => {
    const link = encodeSpanLink(
      { context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) } },
      DEFAULT_LIMITS,
    )

    expect(link.flags).toBeUndefined()
  })
})

describe('createOtlpTracesRequest', () => {
  it('wraps spans with the resource, scope, and schema urls', () => {
    const span = encodeOtlpSpan(base)

    expect(
      createOtlpTracesRequest({ 'service.name': 'checkout' }, [span], {
        scope: { name: 'web', version: '1', schemaUrl: 'https://s/1' },
        resourceSchemaUrl: 'https://r/1',
      }),
    ).toEqual({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'checkout' } },
            ],
          },
          schemaUrl: 'https://r/1',
          scopeSpans: [
            {
              scope: { name: 'web', version: '1' },
              schemaUrl: 'https://s/1',
              spans: [span],
            },
          ],
        },
      ],
    })
  })

  it('defaults the scope name and omits schema urls', () => {
    const request = createOtlpTracesRequest({}, [])

    expect(request.resourceSpans?.[0]).toEqual({
      resource: { attributes: [] },
      scopeSpans: [{ scope: { name: 'som' }, spans: [] }],
    })
  })
})
