import { describe, expect, it } from 'vitest'
import {
  isValidSpanId,
  isValidTraceId,
  validSpanId,
  validTraceFields,
  validTraceId,
} from './trace-ids.js'

describe('trace and span id validation', () => {
  it.each([
    '5b8efff798038103d269b633813fc60c',
    '5B8EFFF798038103D269B633813FC60C',
  ])('accepts the trace id %s', (id) => {
    expect(isValidTraceId(id)).toBe(true)
  })

  it.each([
    '',
    'abc',
    'z'.repeat(32),
    'a'.repeat(31),
    'a'.repeat(33),
    '0'.repeat(32),
    ` ${'a'.repeat(31)}`,
  ])('rejects the trace id %j', (id) => {
    expect(isValidTraceId(id)).toBe(false)
  })

  it.each(['eee19b7ec3c1b174', 'EEE19B7EC3C1B174'])(
    'accepts the span id %s',
    (id) => {
      expect(isValidSpanId(id)).toBe(true)
    },
  )

  it.each(['', 'abc', 'z'.repeat(16), 'a'.repeat(17), '0'.repeat(16)])(
    'rejects the span id %j',
    (id) => {
      expect(isValidSpanId(id)).toBe(false)
    },
  )

  it('returns a valid id as is and an invalid or missing one as undefined', () => {
    expect(validTraceId('A'.repeat(32))).toBe('A'.repeat(32))
    expect(validTraceId('xyz')).toBeUndefined()
    expect(validTraceId(undefined)).toBeUndefined()
    expect(validSpanId('b'.repeat(16))).toBe('b'.repeat(16))
    expect(validSpanId('xyz')).toBeUndefined()
    expect(validSpanId(undefined)).toBeUndefined()
  })
})

describe('validTraceFields', () => {
  const traceId = 'a'.repeat(32)
  const spanId = 'b'.repeat(16)

  it('keeps valid ids, and a single valid id on its own', () => {
    expect(validTraceFields({ traceId, spanId })).toEqual({ traceId, spanId })
    expect(validTraceFields({ traceId })).toEqual({
      traceId,
      spanId: undefined,
    })
    expect(validTraceFields({})).toEqual({
      traceId: undefined,
      spanId: undefined,
    })
  })

  it('drops both ids when either one that was given is invalid', () => {
    expect(validTraceFields({ traceId: 'xyz', spanId })).toEqual({})
    expect(validTraceFields({ traceId, spanId: 'q' })).toEqual({})
    expect(validTraceFields({ traceId: 'xyz' })).toEqual({})
  })
})
