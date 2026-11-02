import { CappedList, CappedMap } from '../utils/capped.js'
import { toUnixNano } from '../utils/clock.js'
import { describeError } from '../otlp/encode-logs.js'
import { DEFAULT_LIMITS, type OTelSpanKind } from '../otlp/otlp.constants.js'
import type {
  LogAttributes,
  LogAttributeValue,
  SpanContext,
  SpanData,
  SpanEventData,
  SpanInit,
  SpanLink,
  SpanStatus,
  SpanTime,
} from '../types.js'
import { isValidTraceContext } from './trace-ids.js'

export function describeException(error: Error | string): LogAttributes {
  if (typeof error === 'string') return { 'exception.message': error }

  const { type, message, stacktrace } = describeError(error)
  return {
    'exception.type': type,
    'exception.message': message,
    ...(stacktrace === undefined ? {} : { 'exception.stacktrace': stacktrace }),
  }
}

// `ok` is final, and the message only applies to `error`.
export function nextStatus(
  current: SpanStatus | undefined,
  requested: SpanStatus,
): SpanStatus | undefined {
  if (current?.code === 'ok') return current
  return requested.code === 'ok'
    ? { code: 'ok' }
    : { code: 'error', message: requested.message }
}

export class Span {
  private name: string
  private readonly kind: OTelSpanKind
  private readonly context: SpanContext
  private readonly parentSpanId: string | undefined
  private readonly startTimeUnixNano: bigint
  private readonly attributes: CappedMap<LogAttributeValue>
  private readonly events: CappedList<SpanEventData>
  private readonly links: CappedList<SpanLink>
  private status: SpanStatus | undefined
  private readonly onEnd: (data: SpanData) => void
  // False once ended, and from the start for a span that is not sampled.
  private recording: boolean

  constructor(init: SpanInit) {
    const limits = init.limits ?? DEFAULT_LIMITS
    this.name = init.name
    this.kind = init.kind
    this.context = init.context
    this.parentSpanId = init.parentSpanId
    this.startTimeUnixNano = init.startTimeUnixNano
    this.attributes = new CappedMap(limits.attributeCountLimit)
    this.events = new CappedList(limits.eventCountLimit)
    this.links = new CappedList(limits.linkCountLimit)
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

  setAttribute(key: string, value: LogAttributeValue): this {
    if (this.recording) this.attributes.set(key, value)
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
    if (this.recording) {
      this.events.add({ name, timeUnixNano: toUnixNano(time), attributes })
    }
    return this
  }

  addLink(link: SpanLink): this {
    // A link to an invalid context would get the whole request rejected.
    if (this.recording && isValidTraceContext(link.context)) {
      this.links.add(link)
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

  setStatus(status: SpanStatus): this {
    if (this.recording) this.status = nextStatus(this.status, status)
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
      attributes: Object.fromEntries(this.attributes.entries),
      droppedAttributesCount: this.attributes.droppedCount,
      events: this.events.items,
      droppedEventsCount: this.events.droppedCount,
      links: this.links.items,
      droppedLinksCount: this.links.droppedCount,
      status: this.status,
    })
  }
}
