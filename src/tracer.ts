import type { LogBatcher } from './batcher.js'
import { nowUnixNano } from './clock.js'
import { generateSpanId, generateTraceId } from './ids.js'
import { OTelSpanKind } from './otel.types.js'
import { encodeOtlpSpan, type OtlpSpan } from './otlp-trace.js'
import { Span, type SpanData } from './span.js'

const SAMPLED_FLAG = 0x01

export type SomTracerInit = {
  onShutdown?: () => void
}

export class SomTracer {
  private readonly batcher: LogBatcher<OtlpSpan>
  private readonly onShutdown: (() => void) | undefined

  constructor(batcher: LogBatcher<OtlpSpan>, options: SomTracerInit = {}) {
    this.batcher = batcher
    this.onShutdown = options.onShutdown
  }

  // Spans dropped because the pending queue was full.
  get droppedSpanCount(): number {
    return this.batcher.droppedCount
  }

  startSpan(name: string): Span {
    return new Span({
      name,
      kind: OTelSpanKind.INTERNAL,
      context: {
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        traceFlags: SAMPLED_FLAG,
      },
      startTimeUnixNano: nowUnixNano(),
      onEnd: (data) => this.enqueue(data),
    })
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
    void this.batcher.add(encodeOtlpSpan(data)).catch(() => undefined)
  }
}
