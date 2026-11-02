import {
  OTelStatusCode,
  type OTelJsonKeyValue,
  type OTelJsonResourceSpans,
  type OTelJsonSpan,
  type OTelJsonSpanEvent,
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
import type { LogAttributes, SpanStatus } from './sdk.types.js'
import type { SpanData, SpanEventData } from './span.js'

export type OtlpSpan = OTelJsonSpan

type EncodedAttributes = {
  attributes: OTelJsonKeyValue[] | undefined
  droppedAttributesCount: number | undefined
}

// Empty lists and zero counts are omitted from the payload.
function encodeLimitedAttributes(
  attributes: LogAttributes,
  limits: OtlpLimits,
): EncodedAttributes {
  const { values, dropped } = encodeAttributes(attributes, limits)
  return {
    attributes: values.length > 0 ? values : undefined,
    droppedAttributesCount: dropped || undefined,
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
    ...encodeLimitedAttributes(data.attributes, limits),
    events:
      data.events.length > 0
        ? data.events.map((event) => encodeEvent(event, limits))
        : undefined,
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
