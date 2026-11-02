import type {
  OTelJsonKeyValue,
  OTelJsonResourceSpans,
  OtlpSpan,
  OTelJsonSpanEvent,
  OTelJsonSpanLink,
  OTelJsonStatus,
  OTelJsonTracesData,
  LogAttributes,
  OtlpLimits,
  OtlpRequestOptions,
  SpanData,
  SpanEventData,
  SpanLink,
  SpanStatus,
} from '../types.js'
import {
  encodeAttributes,
  resourceEnvelope,
  scopeEnvelope,
} from './encode-logs.js'
import { DEFAULT_LIMITS, OTelStatusCode } from './otlp.constants.js'
import { TRACE_FLAGS_MASK } from '../traces/traces.constants.js'

// Empty lists and zero counts are omitted from the payload.
function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined
}

function nonZero(count: number): number | undefined {
  return count > 0 ? count : undefined
}

function encodeLimitedAttributes(
  attributes: LogAttributes,
  limits: OtlpLimits,
  alreadyDropped = 0,
): {
  attributes: OTelJsonKeyValue[] | undefined
  droppedAttributesCount: number | undefined
} {
  const { values, dropped } = encodeAttributes(attributes, limits)
  return {
    attributes: nonEmpty(values),
    droppedAttributesCount: nonZero(dropped + alreadyDropped),
  }
}

export function encodeSpanEvent(
  event: SpanEventData,
  limits: OtlpLimits,
): OTelJsonSpanEvent {
  return {
    timeUnixNano: event.timeUnixNano.toString(),
    name: event.name,
    ...encodeLimitedAttributes(event.attributes, limits),
  }
}

export function encodeSpanLink(
  link: SpanLink,
  limits: OtlpLimits,
): OTelJsonSpanLink {
  const { traceId, spanId, traceFlags } = link.context
  return {
    traceId,
    spanId,
    flags: traceFlags === undefined ? undefined : traceFlags & TRACE_FLAGS_MASK,
    ...encodeLimitedAttributes(link.attributes ?? {}, limits),
  }
}

export function encodeSpanStatus(
  status: SpanStatus | undefined,
): OTelJsonStatus | undefined {
  if (status === undefined) return undefined
  if (status.code === 'ok') return { code: OTelStatusCode.OK }

  return {
    code: OTelStatusCode.ERROR,
    ...(status.message ? { message: status.message } : {}),
  }
}

export function encodeOtlpSpan(
  data: SpanData,
  limits: OtlpLimits = DEFAULT_LIMITS,
): OtlpSpan {
  return {
    traceId: data.context.traceId,
    spanId: data.context.spanId,
    parentSpanId: data.parentSpanId,
    flags: data.context.traceFlags,
    name: data.name,
    kind: data.kind,
    startTimeUnixNano: data.startTimeUnixNano.toString(),
    endTimeUnixNano: data.endTimeUnixNano.toString(),
    ...encodeLimitedAttributes(
      data.attributes,
      limits,
      data.droppedAttributesCount,
    ),
    events: nonEmpty(
      data.events.map((event) => encodeSpanEvent(event, limits)),
    ),
    droppedEventsCount: nonZero(data.droppedEventsCount),
    links: nonEmpty(data.links.map((link) => encodeSpanLink(link, limits))),
    droppedLinksCount: nonZero(data.droppedLinksCount),
    status: encodeSpanStatus(data.status),
  }
}

export function createOtlpTracesRequest(
  resourceAttributes: LogAttributes,
  spans: readonly OtlpSpan[],
  options: OtlpRequestOptions = {},
): OTelJsonTracesData {
  const resourceSpans: OTelJsonResourceSpans = {
    ...resourceEnvelope(resourceAttributes, options),
    scopeSpans: [{ ...scopeEnvelope(options), spans: [...spans] }],
  }

  return { resourceSpans: [resourceSpans] }
}
