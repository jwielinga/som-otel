import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSpanId, generateTraceId } from './ids.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('id generation', () => {
  it('makes a 32 character lowercase hex trace id', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('makes a 16 character lowercase hex span id', () => {
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 100 }, generateTraceId))

    expect(ids.size).toBe(100)
  })

  it('draws again instead of returning an all-zero id', () => {
    let calls = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        calls++
        if (calls > 1) bytes.fill(0xab)
        return bytes
      },
    })

    expect(generateSpanId()).toBe('abababababababab')
    expect(calls).toBe(2)
  })

  it('falls back to Math.random without Web Crypto', () => {
    vi.stubGlobal('crypto', undefined)

    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })
})
