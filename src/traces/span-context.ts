import { generateSpanId, generateTraceId } from './ids.js'
import type { ResolvedSpanContext, TraceContext } from '../types.js'
import { Span } from './span.js'
import { isValidTraceContext } from './trace-ids.js'
import { SAMPLED_FLAG, TRACE_FLAGS_MASK } from './traces.constants.js'

// An invalid parent is ignored, as the OpenTelemetry spec requires.
function toParentContext(
  parent: Span | TraceContext | undefined,
): TraceContext | undefined {
  const context = parent instanceof Span ? parent.spanContext() : parent
  return context && isValidTraceContext(context) ? context : undefined
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
      traceId: parentContext?.traceId.toLowerCase() ?? generateTraceId(),
      spanId: generateSpanId(),
      traceFlags,
    },
    parentSpanId: parentContext?.spanId.toLowerCase(),
    sampled: (traceFlags & SAMPLED_FLAG) !== 0,
  }
}
