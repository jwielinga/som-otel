import { describe, expect, it } from 'vitest'
import { OTelSpanKind } from '../otlp/otlp.constants.js'
import type { SpanData } from '../types.js'
import { runInSpan } from './run-in-span.js'
import { Span } from './span.js'

function setup() {
  const ended: SpanData[] = []
  const span = new Span({
    name: 'work',
    kind: OTelSpanKind.INTERNAL,
    context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 },
    startTimeUnixNano: 0n,
    onEnd: (data) => ended.push(data),
  })
  return { span, ended }
}

describe('runInSpan', () => {
  it('passes the span to fn, returns its value, and ends the span', () => {
    const { span, ended } = setup()

    const result = runInSpan(span, (received) => {
      expect(received).toBe(span)
      return 42
    })

    expect(result).toBe(42)
    expect(ended).toHaveLength(1)
    expect(ended[0]?.status).toBeUndefined()
  })

  it('records a sync throw, sets error status, ends, and rethrows', () => {
    const { span, ended } = setup()
    const error = new RangeError('too big')

    expect(() =>
      runInSpan(span, () => {
        throw error
      }),
    ).toThrow(error)

    expect(ended[0]?.status).toEqual({ code: 'error', message: 'too big' })
    expect(ended[0]?.events[0]?.name).toBe('exception')
  })

  it('records a thrown string as the message', () => {
    const { span, ended } = setup()

    expect(() =>
      runInSpan(span, () => {
        throw 'plain'
      }),
    ).toThrow('plain')

    expect(ended[0]?.status).toEqual({ code: 'error', message: 'plain' })
    expect(ended[0]?.events[0]?.attributes).toEqual({
      'exception.message': 'plain',
    })
  })

  it('ends an async span only when the promise resolves', async () => {
    const { span, ended } = setup()
    let resolve!: (value: string) => void
    const pending = new Promise<string>((done) => {
      resolve = done
    })

    const result = runInSpan(span, () => pending)
    expect(ended).toHaveLength(0)

    resolve('done')
    await expect(result).resolves.toBe('done')
    expect(ended).toHaveLength(1)
  })

  it('records a rejection, ends, and rejects with the same error', async () => {
    const { span, ended } = setup()
    const error = new Error('network down')

    await expect(runInSpan(span, () => Promise.reject(error))).rejects.toBe(
      error,
    )

    expect(ended[0]?.status).toEqual({ code: 'error', message: 'network down' })
  })

  it('treats any thenable as async', async () => {
    const { span, ended } = setup()
    const thenable = { then: (done: (value: number) => void) => done(7) }

    await expect(runInSpan(span, () => thenable)).resolves.toBe(7)
    expect(ended).toHaveLength(1)
  })
})
