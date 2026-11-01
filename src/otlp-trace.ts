import type {
  OTelJsonSpan,
  OTelJsonResourceSpans,
  OTelJsonTracesData,
} from './otel.types.js'
import { encodeResource, encodeScope, type OtlpRequestOptions } from './otlp.js'
import type { SpanData } from './span.js'
import type { LogAttributes } from './sdk.types.js'

export type OtlpSpan = OTelJsonSpan

export function encodeOtlpSpan(data: SpanData): OtlpSpan {
  return {
    traceId: data.context.traceId,
    spanId: data.context.spanId,
    parentSpanId: data.parentSpanId,
    flags: data.context.traceFlags,
    name: data.name,
    kind: data.kind,
    startTimeUnixNano: data.startTimeUnixNano.toString(),
    endTimeUnixNano: data.endTimeUnixNano.toString(),
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
