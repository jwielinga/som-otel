import { OTelSpanKind } from '../otlp/otlp.constants.js'
import type { SpanKind } from '../types.js'

export const TRACE_FLAGS_MASK = 0xff
export const SAMPLED_FLAG = 0x01

export const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i
export const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i
export const ALL_ZEROS_PATTERN = /^0+$/

export const LOGS_PATH_PATTERN = /^([^?#]*?)\/logs(\/?(?:[?#].*)?)$/

export const SPAN_KINDS: Record<SpanKind, OTelSpanKind> = {
  internal: OTelSpanKind.INTERNAL,
  server: OTelSpanKind.SERVER,
  client: OTelSpanKind.CLIENT,
  producer: OTelSpanKind.PRODUCER,
  consumer: OTelSpanKind.CONSUMER,
}
