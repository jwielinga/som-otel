import { describe, expect, it } from 'vitest'
import { traceContextFromApi } from './trace-context.js'

const traceId = '5b8efff798038103d269b633813fc60c'
const spanId = 'eee19b7ec3c1b174'

describe('traceContextFromApi', () => {
  it('reads the span context of the active context', () => {
    const active = { id: 'ctx' }
    const provider = traceContextFromApi({
      context: { active: () => active },
      trace: {
        getSpanContext: (context) =>
          context === active ? { traceId, spanId, traceFlags: 1 } : undefined,
      },
    })

    expect(provider()).toEqual({ traceId, spanId, traceFlags: 1 })
  })

  it('returns undefined when no span is active', () => {
    const provider = traceContextFromApi({
      context: { active: () => ({}) },
      trace: { getSpanContext: () => undefined },
    })

    expect(provider()).toBeUndefined()
  })
})
