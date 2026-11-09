import { describe, expect, it } from 'vitest'
import { SeriesClock } from './series-clock.js'

describe('SeriesClock', () => {
  it('starts a new series at its first time', () => {
    expect(new SeriesClock().advance('a', 10n)).toBe(10n)
  })

  it('starts each window where the previous one ended', () => {
    const clock = new SeriesClock()

    clock.advance('a', 10n)

    expect(clock.advance('a', 25n)).toBe(10n)
    expect(clock.advance('a', 40n)).toBe(25n)
  })

  it('tracks every series on its own', () => {
    const clock = new SeriesClock()

    clock.advance('a', 10n)

    expect(clock.advance('b', 30n)).toBe(30n)
    expect(clock.advance('a', 50n)).toBe(10n)
  })
})
