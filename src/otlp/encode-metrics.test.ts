import { describe, expect, it } from 'vitest'
import { metricKey, seriesKey } from './encode-metrics.js'

const text = (value: string) => ({ stringValue: value })

describe('seriesKey', () => {
  it('ignores the order of attributes', () => {
    expect(
      seriesKey([
        { key: 'a', value: text('1') },
        { key: 'b', value: text('2') },
      ]),
    ).toBe(
      seriesKey([
        { key: 'b', value: text('2') },
        { key: 'a', value: text('1') },
      ]),
    )
  })

  it('ignores the order of entries in nested maps, also inside arrays', () => {
    const map = (...entries: Array<[string, string]>) => ({
      kvlistValue: {
        values: entries.map(([key, value]) => ({ key, value: text(value) })),
      },
    })
    const ab = map(['a', 'x'], ['b', 'y'])
    const ba = map(['b', 'y'], ['a', 'x'])
    const listOf = (item: ReturnType<typeof map>) => ({
      arrayValue: { values: [item] },
    })

    expect(seriesKey([{ key: 'k', value: ab }])).toBe(
      seriesKey([{ key: 'k', value: ba }]),
    )
    expect(seriesKey([{ key: 'k', value: listOf(ab) }])).toBe(
      seriesKey([{ key: 'k', value: listOf(ba) }]),
    )
  })

  it('keeps the order of array elements', () => {
    const list = (...items: string[]) => ({
      arrayValue: { values: items.map(text) },
    })

    expect(seriesKey([{ key: 'k', value: list('1', '2') }])).not.toBe(
      seriesKey([{ key: 'k', value: list('2', '1') }]),
    )
  })

  it('tells different values apart', () => {
    expect(seriesKey([{ key: 'k', value: text('1') }])).not.toBe(
      seriesKey([{ key: 'k', value: text('2') }]),
    )
  })
})

describe('metricKey', () => {
  it('is the same for instruments that differ only in description', () => {
    expect(metricKey({ kind: 'counter', name: 'x', description: 'one' })).toBe(
      metricKey({ kind: 'counter', name: 'x', description: 'two' }),
    )
  })

  it.each([
    ['kind', { kind: 'gauge' as const, name: 'x' }],
    ['name', { kind: 'counter' as const, name: 'y' }],
    ['unit', { kind: 'counter' as const, name: 'x', unit: 'By' }],
  ])('differs by %s', (_what, other) => {
    expect(metricKey({ kind: 'counter', name: 'x' })).not.toBe(metricKey(other))
  })
})
