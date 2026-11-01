import { nowUnixNano } from './clock.js'
import type { OTelSpanKind } from './otel.types.js'
import type { SpanContext } from './sdk.types.js'

// Everything an ended span hands to the exporter; the tracer encodes it.
export type SpanData = {
  name: string
  kind: OTelSpanKind
  context: SpanContext
  parentSpanId: string | undefined
  startTimeUnixNano: bigint
  endTimeUnixNano: bigint
}

export type SpanInit = {
  name: string
  kind: OTelSpanKind
  context: SpanContext
  parentSpanId?: string
  startTimeUnixNano: bigint
  onEnd: (data: SpanData) => void
}

export class Span {
  private readonly name: string
  private readonly kind: OTelSpanKind
  private readonly context: SpanContext
  private readonly parentSpanId: string | undefined
  private readonly startTimeUnixNano: bigint
  private readonly onEnd: (data: SpanData) => void
  private ended = false

  constructor(init: SpanInit) {
    this.name = init.name
    this.kind = init.kind
    this.context = init.context
    this.parentSpanId = init.parentSpanId
    this.startTimeUnixNano = init.startTimeUnixNano
    this.onEnd = init.onEnd
  }

  spanContext(): SpanContext {
    return { ...this.context }
  }

  // False once the span has ended.
  isRecording(): boolean {
    return !this.ended
  }

  end(): void {
    if (this.ended) return
    this.ended = true

    this.onEnd({
      name: this.name,
      kind: this.kind,
      context: this.context,
      parentSpanId: this.parentSpanId,
      startTimeUnixNano: this.startTimeUnixNano,
      endTimeUnixNano: nowUnixNano(),
    })
  }
}
