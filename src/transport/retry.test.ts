import { describe, expect, it } from 'vitest'
import {
  computeBackoffMs,
  parseRetryAfter,
  resolveRetryPolicy,
} from './retry.js'

describe('resolveRetryPolicy', () => {
  it('defaults to 3 attempts and can be disabled', () => {
    expect(resolveRetryPolicy(undefined)).toEqual({
      maxAttempts: 3,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      backoffMultiplier: 2,
    })
    expect(resolveRetryPolicy(false)).toBeUndefined()
  })

  it('merges overrides over the defaults', () => {
    expect(resolveRetryPolicy({ maxAttempts: 5 })).toEqual({
      maxAttempts: 5,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      backoffMultiplier: 2,
    })
  })
})

describe('computeBackoffMs', () => {
  const policy = {
    maxAttempts: 5,
    initialDelayMs: 100,
    maxDelayMs: 350,
    backoffMultiplier: 2,
  }

  it('grows exponentially, jitters in the upper half, and caps at maxDelayMs', () => {
    expect(computeBackoffMs(policy, 1, () => 1)).toBe(100)
    expect(computeBackoffMs(policy, 1, () => 0)).toBe(50)
    expect(computeBackoffMs(policy, 2, () => 1)).toBe(200)
    expect(computeBackoffMs(policy, 3, () => 1)).toBe(350)
    expect(computeBackoffMs(policy, 9, () => 1)).toBe(350)
  })
})

describe('parseRetryAfter', () => {
  it('parses delay-seconds', () => {
    expect(parseRetryAfter('3')).toBe(3_000)
    expect(parseRetryAfter(' 0 ')).toBe(0)
  })

  it('parses HTTP dates relative to now and never goes negative', () => {
    const now = Date.parse('2026-10-05T12:00:00Z')

    expect(parseRetryAfter('Mon, 05 Oct 2026 12:00:10 GMT', now)).toBe(10_000)
    expect(parseRetryAfter('Mon, 05 Oct 2026 11:00:00 GMT', now)).toBe(0)
  })

  it('ignores missing and malformed values', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
  })
})
