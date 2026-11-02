import { generateSpanId, generateTraceId } from './ids.js'
import type { SpanContext, TraceContext } from './sdk.types.js'
import { Span } from './span.js'

const SAMPLED_FLAG = 0x01
const TRACE_FLAGS_MASK = 0xff

export type ResolvedSpanContext = {
  context: SpanContext
  parentSpanId: string | undefined
  // False when the parent's trace flags say the trace is not sampled.
  sampled: boolean
}

function toParentContext(
  parent: Span | TraceContext | undefined,
): TraceContext | undefined {
  return parent instanceof Span ? parent.spanContext() : parent
}

// A child continues its parent's trace and sampling decision; without a parent it starts a sampled trace.
export function resolveSpanContext(
  parent: Span | TraceContext | undefined,
): ResolvedSpanContext {
  const parentContext = toParentContext(parent)
  const traceFlags =
    (parentContext?.traceFlags ?? SAMPLED_FLAG) & TRACE_FLAGS_MASK

  return {
    context: {
      traceId: parentContext?.traceId ?? generateTraceId(),
      spanId: generateSpanId(),
      traceFlags,
    },
    parentSpanId: parentContext?.spanId,
    sampled: (traceFlags & SAMPLED_FLAG) !== 0,
  }
}
