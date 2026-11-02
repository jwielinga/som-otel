import { describe, expect, it } from 'vitest'
import { toUnixNano } from './clock.js'

describe('toUnixNano', () => {
  it('converts a Date', () => {
    expect(toUnixNano(new Date('2026-01-01T00:00:00Z'))).toBe(
      1767225600000000000n,
    )
  })

  it('converts epoch milliseconds, keeping fractions', () => {
    expect(toUnixNano(1767225600500.25)).toBe(1767225600500250000n)
  })

  it('passes a bigint through as nanoseconds', () => {
    expect(toUnixNano(1767225600123456789n)).toBe(1767225600123456789n)
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date('x')])(
    'falls back to now for %s',
    (value) => {
      const before = BigInt(Date.now()) * 1_000_000n - 1_000_000n
      const result = toUnixNano(value)

      expect(result).toBeGreaterThanOrEqual(before)
      expect(result).toBeLessThan(before + 5_000_000_000n)
    },
  )
})
