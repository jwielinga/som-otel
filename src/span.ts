import { toUnixNano } from './clock.js'
import type { OTelSpanKind } from './otel.types.js'
import { DEFAULT_LIMITS, describeError, type OtlpLimits } from './otlp.js'
import type {
  LogAttributes,
  LogAttributeValue,
  SpanContext,
  SpanLink,
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
  droppedAttributesCount: number
  events: SpanEventData[]
  droppedEventsCount: number
  links: SpanLink[]
  droppedLinksCount: number
  status: SpanStatus | undefined
}

export type SpanLimits = Pick<
  OtlpLimits,
  'attributeCountLimit' | 'eventCountLimit' | 'linkCountLimit'
>

export type SpanInit = {
  name: string
  kind: OTelSpanKind
  context: SpanContext
  parentSpanId?: string
  startTimeUnixNano: bigint
  attributes?: LogAttributes
  links?: readonly SpanLink[]
  limits?: SpanLimits
  // Default true; false makes every call a no-op and nothing is exported.
  recording?: boolean
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
  private droppedAttributesCount = 0
  private readonly events: SpanEventData[] = []
  private droppedEventsCount = 0
  private readonly links: SpanLink[] = []
  private droppedLinksCount = 0
  private readonly limits: SpanLimits
  private status: SpanStatus | undefined
  private readonly onEnd: (data: SpanData) => void
  // False once ended, and from the start for a span that is not sampled.
  private recording: boolean

  constructor(init: SpanInit) {
    this.name = init.name
    this.kind = init.kind
    this.context = init.context
    this.parentSpanId = init.parentSpanId
    this.startTimeUnixNano = init.startTimeUnixNano
    this.limits = init.limits ?? DEFAULT_LIMITS
    this.onEnd = init.onEnd
    this.recording = init.recording ?? true
    this.setAttributes(init.attributes ?? {})
    for (const link of init.links ?? []) this.addLink(link)
  }

  spanContext(): SpanContext {
    return { ...this.context }
  }

  isRecording(): boolean {
    return this.recording
  }

  // Updating an existing key never counts against the limit.
  setAttribute(key: string, value: LogAttributeValue): this {
    if (!this.recording) return this

    if (
      !this.attributes.has(key) &&
      this.attributes.size >= this.limits.attributeCountLimit
    ) {
      this.droppedAttributesCount++
    } else {
      this.attributes.set(key, value)
    }
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
    if (!this.recording) return this

    if (this.events.length >= this.limits.eventCountLimit) {
      this.droppedEventsCount++
    } else {
      this.events.push({ name, timeUnixNano: toUnixNano(time), attributes })
    }
    return this
  }

  addLink(link: SpanLink): this {
    if (!this.recording) return this

    if (this.links.length >= this.limits.linkCountLimit) {
      this.droppedLinksCount++
    } else {
      this.links.push(link)
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
    if (!this.recording || this.status?.code === 'ok') return this

    this.status =
      status.code === 'ok'
        ? { code: 'ok' }
        : { code: 'error', message: status.message }
    return this
  }

  updateName(name: string): this {
    if (this.recording) this.name = name
    return this
  }

  end(endTime?: SpanTime): void {
    if (!this.recording) return
    const endTimeUnixNano = toUnixNano(endTime)
    this.recording = false

    this.onEnd({
      name: this.name,
      kind: this.kind,
      context: this.context,
      parentSpanId: this.parentSpanId,
      startTimeUnixNano: this.startTimeUnixNano,
      endTimeUnixNano,
      attributes: Object.fromEntries(this.attributes),
      droppedAttributesCount: this.droppedAttributesCount,
      events: this.events,
      droppedEventsCount: this.droppedEventsCount,
      links: this.links,
      droppedLinksCount: this.droppedLinksCount,
      status: this.status,
    })
  }
}
