const TRACE_ID = /^[0-9a-f]{32}$/i
const SPAN_ID = /^[0-9a-f]{16}$/i
const ALL_ZEROS = /^0+$/

export function isValidTraceId(traceId: string): boolean {
  return TRACE_ID.test(traceId) && !ALL_ZEROS.test(traceId)
}

export function isValidSpanId(spanId: string): boolean {
  return SPAN_ID.test(spanId) && !ALL_ZEROS.test(spanId)
}

export function isValidTraceContext(context: {
  traceId: string
  spanId: string
}): boolean {
  return isValidTraceId(context.traceId) && isValidSpanId(context.spanId)
}

// A collector rejects a whole request over one malformed id, so invalid ids are left out.
export function validTraceId(traceId: string | undefined): string | undefined {
  return traceId !== undefined && isValidTraceId(traceId) ? traceId : undefined
}

export function validSpanId(spanId: string | undefined): string | undefined {
  return spanId !== undefined && isValidSpanId(spanId) ? spanId : undefined
}

// The trace fields of a record: both are dropped when either one that was given is invalid.
export function validTraceFields(fields: {
  traceId?: string
  spanId?: string
}): {
  traceId?: string
  spanId?: string
} {
  const traceId = validTraceId(fields.traceId)
  const spanId = validSpanId(fields.spanId)
  const hasInvalid =
    (fields.traceId !== undefined && traceId === undefined) ||
    (fields.spanId !== undefined && spanId === undefined)

  return hasInvalid ? {} : { traceId, spanId }
}
