import type { Span } from './span.js'

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function endWithFailure(span: Span, error: unknown): void {
  const failure = error instanceof Error ? error : String(error)
  span
    .recordException(failure)
    .setStatus({
      code: 'error',
      message: typeof failure === 'string' ? failure : failure.message,
    })
    .end()
}

// Ends the span when `fn` returns, or settles if it returns a promise.
// A throw or rejection is recorded on the span and rethrown.
export function runInSpan<T>(span: Span, fn: (span: Span) => T): T {
  let result: T
  try {
    result = fn(span)
  } catch (error) {
    endWithFailure(span, error)
    throw error
  }

  if (!isPromiseLike(result)) {
    span.end()
    return result
  }

  return Promise.resolve(result).then(
    (value) => {
      span.end()
      return value
    },
    (error: unknown) => {
      endWithFailure(span, error)
      throw error
    },
  ) as T
}
