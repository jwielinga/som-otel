import type { LogBatcher } from '../transport/batcher.js'
import { toUnixNano } from '../utils/clock.js'
import { DEFAULT_LIMITS } from '../otlp/otlp.constants.js'
import { encodeOtlpSpan } from '../otlp/encode-traces.js'
import { runInSpan } from './run-in-span.js'
import type {
  OtlpLimits,
  OtlpSpan,
  SomTracerInit,
  SpanData,
  SpanOptions,
} from '../types.js'
import { resolveSpanContext } from './span-context.js'
import { Span } from './span.js'
import { SPAN_KINDS } from './traces.constants.js'

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
      kind: SPAN_KINDS[options.kind ?? 'internal'],
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
