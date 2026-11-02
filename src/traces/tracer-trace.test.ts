import { describe, expect, it } from 'vitest'
import { OTelSpanKind, OTelStatusCode } from '../otlp/otlp.constants.js'
import { attributeOf, setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

describe('tracer.trace', () => {
  it('runs a sync function, returns its value, and ends the span', async () => {
    const { som, collector } = setup()

    const result = som.tracer.trace('compute', (span) => {
      span.setAttribute('items', 3)
      return 42
    })
    await som.flush()

    expect(result).toBe(42)
    expect(collector.spans).toHaveLength(1)
    expect(collector.spans[0]).toMatchObject({ name: 'compute' })
    expect(collector.spans[0]).not.toHaveProperty('status')
  })

  it('records the error, sets error status, rethrows, and ends on a sync throw', async () => {
    const { som, collector } = setup()
    const error = new RangeError('too big')

    expect(() =>
      som.tracer.trace('compute', () => {
        throw error
      }),
    ).toThrow(error)
    await som.flush()

    const [span] = collector.spans
    expect(span?.status).toEqual({
      code: OTelStatusCode.ERROR,
      message: 'too big',
    })
    const [event] = span?.events ?? []
    expect(event?.name).toBe('exception')
    expect(attributeOf(event?.attributes, 'exception.type')).toEqual({
      stringValue: 'RangeError',
    })
  })

  it('records a thrown non-error value as a message', async () => {
    const { som, collector } = setup()

    expect(() =>
      som.tracer.trace('compute', () => {
        throw 'plain failure'
      }),
    ).toThrow('plain failure')
    await som.flush()

    expect(collector.spans[0]?.status).toEqual({
      code: OTelStatusCode.ERROR,
      message: 'plain failure',
    })
  })

  it('ends an async span only when the promise settles', async () => {
    const { som, collector } = setup()
    let resolve!: (value: string) => void
    const pending = new Promise<string>((done) => {
      resolve = done
    })

    const result = som.tracer.trace('load', () => pending)
    await som.flush()
    expect(collector.spans).toHaveLength(0)

    resolve('done')
    await expect(result).resolves.toBe('done')
    await som.flush()

    expect(collector.spans).toHaveLength(1)
    expect(collector.spans[0]).toMatchObject({ name: 'load' })
    expect(collector.spans[0]).not.toHaveProperty('status')
  })

  it('records a rejection, sets error status, and rethrows', async () => {
    const { som, collector } = setup()
    const error = new Error('network down')

    await expect(
      som.tracer.trace('load', async () => {
        await Promise.resolve()
        throw error
      }),
    ).rejects.toBe(error)
    await som.flush()

    expect(collector.spans[0]?.status).toEqual({
      code: OTelStatusCode.ERROR,
      message: 'network down',
    })
    expect(collector.spans[0]?.events?.[0]?.name).toBe('exception')
  })

  it('passes span options and supports nesting through parent', async () => {
    const { som, collector } = setup()

    await som.tracer.trace(
      'outer',
      (outer) =>
        som.tracer.trace('inner', async () => undefined, { parent: outer }),
      { kind: 'server' },
    )
    await som.flush()

    const inner = collector.spans.find((span) => span.name === 'inner')
    const outer = collector.spans.find((span) => span.name === 'outer')
    expect(outer?.kind).toBe(OTelSpanKind.SERVER)
    expect(inner?.parentSpanId).toBe(outer?.spanId)
    expect(inner?.traceId).toBe(outer?.traceId)
  })
})
