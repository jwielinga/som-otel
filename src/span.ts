import { toUnixNano } from './clock.js'
import type { OTelSpanKind } from './otel.types.js'
import { describeError } from './otlp.js'
import type {
  LogAttributes,
  LogAttributeValue,
  SpanContext,
  SpanStatus,
  SpanTime,
} from './sdk.types.js'

export type SpanEventData = {
  name: string
  timeUnixNano: bigint
  attributes: LogAttributes
}

// Everything an ended span hands to the exporter; the tracer encodes it.
export type SpanData = {
  name: string
  kind: OTelSpanKind
  context: SpanContext
  parentSpanId: string | undefined
  startTimeUnixNano: bigint
  endTimeUnixNano: bigint
  attributes: LogAttributes
  events: SpanEventData[]
  status: SpanStatus | undefined
}

export type SpanInit = {
  name: string
  kind: OTelSpanKind
  context: SpanContext
  parentSpanId?: string
  startTimeUnixNano: bigint
  attributes?: LogAttributes
  onEnd: (data: SpanData) => void
}

function describeException(error: Error | string): LogAttributes {
  if (typeof error === 'string') return { 'exception.message': error }

  const { type, message, stacktrace } = describeError(error)
  return {
    'exception.type': type,
    'exception.message': message,
    ...(stacktrace === undefined ? {} : { 'exception.stacktrace': stacktrace }),
  }
}

export class Span {
  private name: string
  private readonly kind: OTelSpanKind
  private readonly context: SpanContext
  private readonly parentSpanId: string | undefined
  private readonly startTimeUnixNano: bigint
  private readonly attributes = new Map<string, LogAttributeValue>()
  private readonly events: SpanEventData[] = []
  private status: SpanStatus | undefined
  private readonly onEnd: (data: SpanData) => void
  private ended = false

  constructor(init: SpanInit) {
    this.name = init.name
    this.kind = init.kind
    this.context = init.context
    this.parentSpanId = init.parentSpanId
    this.startTimeUnixNano = init.startTimeUnixNano
    this.onEnd = init.onEnd
    this.setAttributes(init.attributes ?? {})
  }

  spanContext(): SpanContext {
    return { ...this.context }
  }

  // False once the span has ended.
  isRecording(): boolean {
    return !this.ended
  }

  setAttribute(key: string, value: LogAttributeValue): this {
    if (!this.ended) this.attributes.set(key, value)
    return this
  }

  setAttributes(attributes: LogAttributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value)
    }
    return this
  }

  addEvent(
    name: string,
    attributes: LogAttributes = {},
    time?: SpanTime,
  ): this {
    if (!this.ended) {
      this.events.push({ name, timeUnixNano: toUnixNano(time), attributes })
    }
    return this
  }

  // Follows the exception semantic conventions; it does not change the status.
  recordException(
    error: Error | string,
    attributes: LogAttributes = {},
    time?: SpanTime,
  ): this {
    return this.addEvent(
      'exception',
      { ...describeException(error), ...attributes },
      time,
    )
  }

  // `ok` is final, and the message only applies to `error`.
  setStatus(status: SpanStatus): this {
    if (this.ended || this.status?.code === 'ok') return this

    this.status =
      status.code === 'ok'
        ? { code: 'ok' }
        : { code: 'error', message: status.message }
    return this
  }

  updateName(name: string): this {
    if (!this.ended) this.name = name
    return this
  }

  end(endTime?: SpanTime): void {
    if (this.ended) return
    const endTimeUnixNano = toUnixNano(endTime)
    this.ended = true

    this.onEnd({
      name: this.name,
      kind: this.kind,
      context: this.context,
      parentSpanId: this.parentSpanId,
      startTimeUnixNano: this.startTimeUnixNano,
      endTimeUnixNano,
      attributes: Object.fromEntries(this.attributes),
      events: this.events,
      status: this.status,
    })
  }
}
