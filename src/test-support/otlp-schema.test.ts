import { describe, expect, it } from 'vitest'
import { logRequestProblems, traceRequestProblems } from './otlp-schema.js'

const span = {
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  name: 'x',
  startTimeUnixNano: '1',
  endTimeUnixNano: '2',
}

function traces(overrides: Record<string, unknown> = {}) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          { scope: { name: 'som' }, spans: [{ ...span, ...overrides }] },
        ],
      },
    ],
  }
}

describe('OTLP/JSON schema check', () => {
  it('accepts a valid trace request, including uppercase hex ids', () => {
    expect(traceRequestProblems(traces())).toEqual([])
    expect(traceRequestProblems(traces({ traceId: 'A'.repeat(32) }))).toEqual(
      [],
    )
  })

  it.each([
    ['an unknown field', { naem: 'typo' }, 'unknown field'],
    ['a string enum', { kind: 'CLIENT' }, 'enum number'],
    ['an out of range enum', { kind: 9 }, 'enum number'],
    ['a base64 trace id', { traceId: 'qrq6uro=' }, '32 hex characters'],
    ['an all-zero span id', { spanId: '0'.repeat(16) }, '16 hex characters'],
    ['a numeric timestamp', { startTimeUnixNano: 1 }, 'decimal string'],
    ['a missing name', { name: undefined }, 'required'],
    [
      'an AnyValue with two fields',
      {
        attributes: [
          { key: 'k', value: { stringValue: 'a', boolValue: true } },
        ],
      },
      'exactly one field',
    ],
    [
      'a non-string int64',
      { attributes: [{ key: 'k', value: { intValue: 5 } }] },
      'int64',
    ],
    [
      'a non-finite double',
      { attributes: [{ key: 'k', value: { doubleValue: Number.NaN } }] },
      'finite number',
    ],
    ['a negative dropped count', { droppedEventsCount: -1 }, 'uint32'],
  ])('rejects %s', (_name, overrides, expected) => {
    const problems = traceRequestProblems(traces(overrides))

    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(expected)
  })

  it('checks log requests', () => {
    const valid = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: 'som' },
              logRecords: [
                {
                  timeUnixNano: '1',
                  severityNumber: 9,
                  body: { stringValue: 'x' },
                  traceId: 'a'.repeat(32),
                },
              ],
            },
          ],
        },
      ],
    }

    expect(logRequestProblems(valid)).toEqual([])
    expect(
      logRequestProblems({
        resourceLogs: [
          {
            scopeLogs: [{ logRecords: [{ severityNumber: 99 }] }],
          },
        ],
      }),
    ).not.toEqual([])
  })
})
