import { afterEach, describe, expect, it, vi } from 'vitest'
import { OTelSeverityNumber } from './otlp.constants.js'
import {
  createOtlpLogRecord,
  createOtlpLogsRequest,
  encodeOtlpLogRecord,
} from './encode-logs.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('createOtlpLogRecord', () => {
  it('maps severity helpers to OTel severity number and text', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))

    expect(createOtlpLogRecord('warn', 'low stock', {})).toEqual({
      timeUnixNano: '1791201600000000000',
      observedTimeUnixNano: '1791201600000000000',
      severityNumber: OTelSeverityNumber.WARN,
      severityText: 'WARN',
      body: { stringValue: 'low stock' },
      attributes: [],
    })
  })

  it('encodes every attribute value type', () => {
    const record = createOtlpLogRecord('info', 'x', {
      text: 'a',
      flag: true,
      ratio: 1.5,
      big: 9_007_199_254_740_993n,
      bytes: new Uint8Array([104, 105]),
      list: [1, 'b'],
      nested: { inner: { deep: false } },
    })

    expect(record.attributes).toEqual([
      { key: 'text', value: { stringValue: 'a' } },
      { key: 'flag', value: { boolValue: true } },
      { key: 'ratio', value: { doubleValue: 1.5 } },
      { key: 'big', value: { intValue: '9007199254740993' } },
      { key: 'bytes', value: { bytesValue: 'aGk=' } },
      {
        key: 'list',
        value: {
          arrayValue: {
            values: [{ intValue: '1' }, { stringValue: 'b' }],
          },
        },
      },
      {
        key: 'nested',
        value: {
          kvlistValue: {
            values: [
              {
                key: 'inner',
                value: {
                  kvlistValue: {
                    values: [{ key: 'deep', value: { boolValue: false } }],
                  },
                },
              },
            ],
          },
        },
      },
    ])
  })

  it('encodes safe integers as intValue and other numbers as doubleValue', () => {
    const record = createOtlpLogRecord('info', 'x', {
      count: 200,
      negative: -7,
      zero: 0,
      fraction: 0.5,
      beyondSafe: 2 ** 53,
      huge: 1e21,
    })

    expect(record.attributes).toEqual([
      { key: 'count', value: { intValue: '200' } },
      { key: 'negative', value: { intValue: '-7' } },
      { key: 'zero', value: { intValue: '0' } },
      { key: 'fraction', value: { doubleValue: 0.5 } },
      { key: 'beyondSafe', value: { doubleValue: 2 ** 53 } },
      { key: 'huge', value: { doubleValue: 1e21 } },
    ])
  })

  it('accepts the full signed int64 range', () => {
    const record = createOtlpLogRecord('info', 'x', {
      min: -(2n ** 63n),
      max: 2n ** 63n - 1n,
    })

    expect(record.attributes).toEqual([
      { key: 'min', value: { intValue: '-9223372036854775808' } },
      { key: 'max', value: { intValue: '9223372036854775807' } },
    ])
  })

  it('rejects non-finite numbers and names the nested key', () => {
    expect(() => createOtlpLogRecord('info', 'x', { n: Number.NaN })).toThrow(
      'Log attribute "n" must be a finite number.',
    )
    expect(() =>
      createOtlpLogRecord('info', 'x', { outer: { inner: Infinity } }),
    ).toThrow('Log attribute "outer.inner" must be a finite number.')
  })

  it('rejects bigint values outside signed int64', () => {
    expect(() => createOtlpLogRecord('info', 'x', { big: 2n ** 63n })).toThrow(
      'Log attribute "big" must fit in a signed int64.',
    )
    expect(() =>
      createOtlpLogRecord('info', 'x', { small: -(2n ** 63n) - 1n }),
    ).toThrow('Log attribute "small" must fit in a signed int64.')
  })

  it('encodes large byte arrays without exceeding call stack limits', () => {
    const bytes = new Uint8Array(200_000).fill(65)
    const record = createOtlpLogRecord('info', 'x', { bytes })

    expect(record.attributes?.[0]?.value?.bytesValue).toBe(
      btoa('A'.repeat(200_000)),
    )
  })
})

describe('encodeOtlpLogRecord', () => {
  it('converts timestamps to strings and leaves unset fields undefined', () => {
    const record = encodeOtlpLogRecord({
      timeUnixNano: 1_700_000_000_000_000_000n,
      severityNumber: OTelSeverityNumber.ERROR,
      body: 'boom',
      traceId: '5B8EFFF798038103D269B633813FC60C',
      spanId: 'EEE19B7EC3C1B174',
      eventName: 'payment.failed',
    })

    expect(record).toMatchObject({
      timeUnixNano: '1700000000000000000',
      severityNumber: OTelSeverityNumber.ERROR,
      body: { stringValue: 'boom' },
      traceId: '5B8EFFF798038103D269B633813FC60C',
      spanId: 'EEE19B7EC3C1B174',
      eventName: 'payment.failed',
    })
    expect(record.observedTimeUnixNano).toBeUndefined()
    expect(record.attributes).toBeUndefined()
  })

  it('omits unset fields from serialized JSON', () => {
    expect(JSON.parse(JSON.stringify(encodeOtlpLogRecord({})))).toEqual({})
  })
})

describe('createOtlpLogsRequest', () => {
  it('wraps records with resource attributes and the som scope', () => {
    const logRecord = createOtlpLogRecord('info', 'x', {})

    expect(
      createOtlpLogsRequest({ 'service.name': 'checkout' }, [logRecord]),
    ).toEqual({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'checkout' } },
            ],
          },
          scopeLogs: [{ scope: { name: 'som' }, logRecords: [logRecord] }],
        },
      ],
    })
  })
})
