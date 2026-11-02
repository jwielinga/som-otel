import {
  OTelStatusCode,
  type OTelJsonKeyValue,
  type OTelJsonResourceSpans,
  type OTelJsonSpan,
  type OTelJsonSpanEvent,
  type OTelJsonSpanLink,
  type OTelJsonStatus,
  type OTelJsonTracesData,
} from './otel.types.js'
import {
  DEFAULT_LIMITS,
  encodeAttributes,
  encodeResource,
  encodeScope,
  type OtlpLimits,
  type OtlpRequestOptions,
} from './otlp.js'
import type { LogAttributes, SpanLink, SpanStatus } from './sdk.types.js'
import type { SpanData, SpanEventData } from './span.js'

const TRACE_FLAGS_MASK = 0xff

export type OtlpSpan = OTelJsonSpan

type EncodedAttributes = {
  attributes: OTelJsonKeyValue[] | undefined
  droppedAttributesCount: number | undefined
}

// Empty lists and zero counts are omitted from the payload.
function encodeLimitedAttributes(
  attributes: LogAttributes,
  limits: OtlpLimits,
  alreadyDropped = 0,
): EncodedAttributes {
  const { values, dropped } = encodeAttributes(attributes, limits)
  return {
    attributes: values.length > 0 ? values : undefined,
    droppedAttributesCount: dropped + alreadyDropped || undefined,
  }
}

function encodeEvent(
  event: SpanEventData,
  limits: OtlpLimits,
): OTelJsonSpanEvent {
  return {
    timeUnixNano: event.timeUnixNano.toString(),
    name: event.name,
    ...encodeLimitedAttributes(event.attributes, limits),
  }
}

function encodeLink(link: SpanLink, limits: OtlpLimits): OTelJsonSpanLink {
  const { traceId, spanId, traceFlags } = link.context
  return {
    traceId,
    spanId,
    flags: traceFlags === undefined ? undefined : traceFlags & TRACE_FLAGS_MASK,
    ...encodeLimitedAttributes(link.attributes ?? {}, limits),
  }
}

function encodeStatus(
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
    events:
      data.events.length > 0
        ? data.events.map((event) => encodeEvent(event, limits))
        : undefined,
    droppedEventsCount: data.droppedEventsCount || undefined,
    links:
      data.links.length > 0
        ? data.links.map((link) => encodeLink(link, limits))
        : undefined,
    droppedLinksCount: data.droppedLinksCount || undefined,
    status: encodeStatus(data.status),
  }
}

export function createOtlpTracesRequest(
  resourceAttributes: LogAttributes,
  spans: readonly OtlpSpan[],
  options: OtlpRequestOptions = {},
): OTelJsonTracesData {
  const resourceSpans: OTelJsonResourceSpans = {
    resource: encodeResource(resourceAttributes),
    scopeSpans: [
      {
        scope: encodeScope(options.scope),
        spans: [...spans],
        ...(options.scope?.schemaUrl === undefined
          ? {}
          : { schemaUrl: options.scope.schemaUrl }),
      },
    ],
    ...(options.resourceSchemaUrl === undefined
      ? {}
      : { schemaUrl: options.resourceSchemaUrl }),
  }

  return { resourceSpans: [resourceSpans] }
}
