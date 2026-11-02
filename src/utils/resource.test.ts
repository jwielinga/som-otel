import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectResourceAttributes } from './resource.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectResourceAttributes', () => {
  it('reports SDK, user agent, language, and UA client hints', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Test',
      language: 'nl-NL',
      userAgentData: {
        brands: [{ brand: 'Chromium', version: '120' }],
        mobile: false,
        platform: 'macOS',
      },
    })

    expect(detectResourceAttributes()).toEqual({
      'telemetry.sdk.name': 'som-otel',
      'telemetry.sdk.language': 'webjs',
      'user_agent.original': 'Mozilla/5.0 Test',
      'browser.language': 'nl-NL',
      'browser.brands': ['Chromium 120'],
      'browser.mobile': false,
      'browser.platform': 'macOS',
    })
  })

  it('omits browser attributes when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined)

    expect(detectResourceAttributes()).toEqual({
      'telemetry.sdk.name': 'som-otel',
      'telemetry.sdk.language': 'webjs',
    })
  })
})
