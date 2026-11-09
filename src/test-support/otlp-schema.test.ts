import { describe, expect, it } from 'vitest'
import {
  logRequestProblems,
  metricRequestProblems,
  traceRequestProblems,
} from './otlp-schema.js'

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

  describe('metrics', () => {
    const sumPoint = {
      startTimeUnixNano: '1',
      timeUnixNano: '2',
      asInt: '3',
    }
    const histogramPoint = {
      startTimeUnixNano: '1',
      timeUnixNano: '2',
      count: '3',
      sum: 6,
      bucketCounts: ['1', '2', '0'],
      explicitBounds: [5, 10],
      min: 1,
      max: 5,
    }

    function metrics(metricBody: Record<string, unknown>) {
      return {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                scope: { name: 'som' },
                metrics: [{ name: 'm', ...metricBody }],
              },
            ],
          },
        ],
      }
    }

    it('accepts valid sum, gauge and histogram metrics', () => {
      expect(
        metricRequestProblems(
          metrics({
            sum: {
              dataPoints: [sumPoint],
              aggregationTemporality: 1,
              isMonotonic: true,
            },
          }),
        ),
      ).toEqual([])
      expect(
        metricRequestProblems(
          metrics({
            gauge: { dataPoints: [{ timeUnixNano: '2', asDouble: 0.5 }] },
          }),
        ),
      ).toEqual([])
      expect(
        metricRequestProblems(
          metrics({
            histogram: {
              dataPoints: [histogramPoint],
              aggregationTemporality: 1,
            },
          }),
        ),
      ).toEqual([])
    })

    it.each([
      [
        'a missing name',
        { name: undefined, gauge: { dataPoints: [] } },
        'required',
      ],
      [
        'both asInt and asDouble',
        { gauge: { dataPoints: [{ asInt: '1', asDouble: 1 }] } },
        'exactly one of asInt or asDouble',
      ],
      [
        'neither asInt nor asDouble',
        { gauge: { dataPoints: [{ timeUnixNano: '1' }] } },
        'exactly one of asInt or asDouble',
      ],
      ['a numeric asInt', { gauge: { dataPoints: [{ asInt: 1 }] } }, 'int64'],
      [
        'an out of range temporality',
        { sum: { dataPoints: [], aggregationTemporality: 3 } },
        'enum number',
      ],
      [
        'bucket counts that do not match the bounds',
        {
          histogram: {
            dataPoints: [{ ...histogramPoint, bucketCounts: ['3', '0'] }],
          },
        },
        'one more bucketCounts',
      ],
      [
        'bucket counts that do not add up to the count',
        {
          histogram: {
            dataPoints: [{ ...histogramPoint, count: '4' }],
          },
        },
        'add up to count',
      ],
      [
        'descending bounds',
        {
          histogram: {
            dataPoints: [{ ...histogramPoint, explicitBounds: [10, 5] }],
          },
        },
        'ascending',
      ],
    ])('rejects %s', (_name, body, expected) => {
      const problems = metricRequestProblems(metrics(body))

      expect(problems.length).toBeGreaterThan(0)
      expect(problems.join('\n')).toContain(expected)
    })
  })
})
