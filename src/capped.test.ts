import { describe, expect, it } from 'vitest'
import { CappedList, CappedMap } from './capped.js'

describe('CappedList', () => {
  it('keeps items up to the limit and counts the rest', () => {
    const list = new CappedList<string>(2)

    list.add('a')
    list.add('b')
    list.add('c')
    list.add('d')

    expect(list.items).toEqual(['a', 'b'])
    expect(list.droppedCount).toBe(2)
  })

  it('drops everything with a limit of zero', () => {
    const list = new CappedList<number>(0)

    list.add(1)

    expect(list.items).toEqual([])
    expect(list.droppedCount).toBe(1)
  })
})

describe('CappedMap', () => {
  it('drops new keys past the limit and counts them', () => {
    const map = new CappedMap<number>(2)

    map.set('a', 1)
    map.set('b', 2)
    map.set('c', 3)

    expect([...map.entries.keys()]).toEqual(['a', 'b'])
    expect(map.droppedCount).toBe(1)
  })

  it('still updates an existing key at the limit, keeping its position', () => {
    const map = new CappedMap<number>(2)
    map.set('a', 1)
    map.set('b', 2)

    map.set('a', 10)

    expect([...map.entries]).toEqual([
      ['a', 10],
      ['b', 2],
    ])
    expect(map.droppedCount).toBe(0)
  })
})
