import type { LogBatcher } from './batcher.js'
import { toUnixNano } from './clock.js'
import { OTelSpanKind } from './otel.types.js'
import { DEFAULT_LIMITS, type OtlpLimits } from './otlp.js'
import { encodeOtlpSpan, type OtlpSpan } from './otlp-trace.js'
import { runInSpan } from './run-in-span.js'
import type { SpanKind, SpanOptions } from './sdk.types.js'
import { resolveSpanContext } from './span-context.js'
import { Span, type SpanData } from './span.js'

const spanKinds: Record<SpanKind, OTelSpanKind> = {
  internal: OTelSpanKind.INTERNAL,
  server: OTelSpanKind.SERVER,
  client: OTelSpanKind.CLIENT,
  producer: OTelSpanKind.PRODUCER,
  consumer: OTelSpanKind.CONSUMER,
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
  private isShutdown = false

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
    const { context, parentSpanId, sampled } = resolveSpanContext(
      options.parent,
    )

    return new Span({
      name,
      kind: spanKinds[options.kind ?? 'internal'],
      context,
      parentSpanId,
      // Unsampled and post-shutdown spans still carry the trace on, but record nothing.
      recording: sampled && !this.isShutdown,
      startTimeUnixNano: toUnixNano(options.startTime),
      attributes: options.attributes,
      links: options.links,
      limits: this.limits,
      onEnd: (data) => this.enqueue(data),
    })
  }

  // Runs `fn` in a new span; see runInSpan.
  trace<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T {
    return runInSpan(this.startSpan(name, options), fn)
  }

  flush(): Promise<void> {
    return this.batcher.flush()
  }

  shutdown(): Promise<void> {
    this.isShutdown = true
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
