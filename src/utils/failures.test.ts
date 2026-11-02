import { describe, expect, it } from 'vitest'
import { collectFailures, throwFailures } from './failures.js'

describe('collectFailures', () => {
  it('returns the rejection reasons in order and skips fulfilled results', () => {
    const results: Array<PromiseSettledResult<unknown>> = [
      { status: 'rejected', reason: 'first' },
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: 'second' },
    ]

    expect(collectFailures(results)).toEqual(['first', 'second'])
  })

  it('returns an empty list when nothing failed', () => {
    expect(collectFailures([{ status: 'fulfilled', value: 1 }])).toEqual([])
  })
})

describe('throwFailures', () => {
  it('does nothing without failures', () => {
    expect(() => throwFailures([], 'many')).not.toThrow()
  })

  it('throws a single failure as is', () => {
    const error = new Error('one')

    expect(() => throwFailures([error], 'many')).toThrow(error)
  })

  it('wraps several failures in an AggregateError with the message', () => {
    const errors = [new Error('a'), new Error('b')]

    expect(() => throwFailures(errors, 'many failed')).toThrow(
      expect.objectContaining({
        name: 'AggregateError',
        message: 'many failed',
        errors,
      }),
    )
  })
})
