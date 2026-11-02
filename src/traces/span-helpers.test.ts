import { describe, expect, it } from 'vitest'
import { describeException, nextStatus } from './span.js'

describe('nextStatus', () => {
  it('sets an error with its message', () => {
    expect(nextStatus(undefined, { code: 'error', message: 'boom' })).toEqual({
      code: 'error',
      message: 'boom',
    })
  })

  it('drops the message for ok', () => {
    expect(nextStatus(undefined, { code: 'ok', message: 'ignored' })).toEqual({
      code: 'ok',
    })
  })

  it('lets ok replace an error', () => {
    expect(nextStatus({ code: 'error' }, { code: 'ok' })).toEqual({
      code: 'ok',
    })
  })

  it('keeps ok final', () => {
    const current = { code: 'ok' } as const

    expect(nextStatus(current, { code: 'error', message: 'late' })).toBe(
      current,
    )
  })
})

describe('describeException', () => {
  it('describes an error by type, message, and stack trace', () => {
    const error = new TypeError('bad')

    expect(describeException(error)).toEqual({
      'exception.type': 'TypeError',
      'exception.message': 'bad',
      'exception.stacktrace': error.stack,
    })
  })

  it('omits the stack trace when there is none', () => {
    const error = new Error('bad')
    error.stack = undefined

    expect(describeException(error)).not.toHaveProperty('exception.stacktrace')
  })

  it('describes a string as a message only', () => {
    expect(describeException('timed out')).toEqual({
      'exception.message': 'timed out',
    })
  })
})
