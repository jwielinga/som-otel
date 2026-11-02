import type { OTelApiLike, TraceContextProvider } from '../types.js'

// Usage: traceContextFromApi({ trace, context }) with `@opentelemetry/api`.
export function traceContextFromApi<TContext>(
  api: OTelApiLike<TContext>,
): TraceContextProvider {
  return () => api.trace.getSpanContext(api.context.active())
}
