import type { LogBatcher } from './batcher.js'
import { toUnixNano } from './clock.js'
import { generateSpanId, generateTraceId } from './ids.js'
import { OTelSpanKind } from './otel.types.js'
import { DEFAULT_LIMITS, type OtlpLimits } from './otlp.js'
import { encodeOtlpSpan, type OtlpSpan } from './otlp-trace.js'
import type { SpanKind, SpanOptions, TraceContext } from './sdk.types.js'
import { Span, type SpanData } from './span.js'

const SAMPLED_FLAG = 0x01
const TRACE_FLAGS_MASK = 0xff

const spanKinds: Record<SpanKind, OTelSpanKind> = {
  internal: OTelSpanKind.INTERNAL,
  server: OTelSpanKind.SERVER,
  client: OTelSpanKind.CLIENT,
  producer: OTelSpanKind.PRODUCER,
  consumer: OTelSpanKind.CONSUMER,
}

function toParentContext(
  parent: Span | TraceContext | undefined,
): TraceContext | undefined {
  return parent instanceof Span ? parent.spanContext() : parent
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function endWithFailure(span: Span, error: unknown): void {
  span
    .recordException(error instanceof Error ? error : String(error))
    .setStatus({
      code: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  span.end()
}

export type SomTracerInit = {
  limits?: OtlpLimits
  // Called when a span cannot be encoded; end() itself never throws.
  onError?: (error: unknown) => void
  onShutdown?: () => void
}

export class SomTracer {
  private readonly batcher: LogBatcher<OtlpSpan>
  private readonly limits: OtlpLimits
  private readonly onError: ((error: unknown) => void) | undefined
  private readonly onShutdown: (() => void) | undefined

  constructor(batcher: LogBatcher<OtlpSpan>, options: SomTracerInit = {}) {
    this.batcher = batcher
    this.limits = options.limits ?? DEFAULT_LIMITS
    this.onError = options.onError
    this.onShutdown = options.onShutdown
  }

  // Spans dropped because the pending queue was full.
  get droppedSpanCount(): number {
    return this.batcher.droppedCount
  }

  startSpan(name: string, options: SpanOptions = {}): Span {
    const parent = toParentContext(options.parent)
    const traceFlags = (parent?.traceFlags ?? SAMPLED_FLAG) & TRACE_FLAGS_MASK

    return new Span({
      name,
      kind: spanKinds[options.kind ?? 'internal'],
      context: {
        traceId: parent?.traceId ?? generateTraceId(),
        spanId: generateSpanId(),
        traceFlags,
      },
      parentSpanId: parent?.spanId,
      // The parent's sampling decision wins; unsampled spans still carry the trace on.
      recording: (traceFlags & SAMPLED_FLAG) !== 0,
      startTimeUnixNano: toUnixNano(options.startTime),
      attributes: options.attributes,
      links: options.links,
      limits: this.limits,
      onEnd: (data) => this.enqueue(data),
    })
  }

  // Runs `fn` in a new span. The span ends when `fn` returns, or settles if it returns a
  // promise; a throw or rejection is recorded on the span and rethrown.
  trace<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T {
    const span = this.startSpan(name, options)

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

  flush(): Promise<void> {
    return this.batcher.flush()
  }

  shutdown(): Promise<void> {
    this.onShutdown?.()
    return this.batcher.shutdown()
  }

  // Failures surface through onDiagnostic and flush(), so the per-span promise is dropped.
  private enqueue(data: SpanData): void {
    let encoded: OtlpSpan
    try {
      encoded = encodeOtlpSpan(data, this.limits)
    } catch (error) {
      this.onError?.(error)
      return
    }
    void this.batcher.add(encoded).catch(() => undefined)
  }
}
