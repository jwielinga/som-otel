import type { OTelAnyValue } from './otel.types.js'
import type { Span } from './span.js'

export type LogSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error'

// `Error` values are serialized as exception type, message, and stack trace.
export type LogAttributeValue = OTelAnyValue | Error

export type LogAttributes = Readonly<Record<string, LogAttributeValue>>

// Hex ids: 32 characters for traceId, 16 for spanId.
export type TraceContext = {
  traceId: string
  spanId: string
  traceFlags?: number
}

export type TraceContextProvider = () => TraceContext | undefined

// Identifies a span; assignable to TraceContext.
export type SpanContext = {
  traceId: string
  spanId: string
  traceFlags: number
}

export type SpanKind =
  'internal' | 'server' | 'client' | 'producer' | 'consumer'

// A Date, epoch milliseconds (may be fractional), or epoch nanoseconds as a bigint.
export type SpanTime = Date | number | bigint

// Unset is the default and cannot be set; `ok` is final and drops the message.
export type SpanStatus = { code: 'ok' | 'error'; message?: string }

export type SpanLink = {
  context: TraceContext
  attributes?: LogAttributes
}

export type SpanOptions = {
  // Default 'internal'.
  kind?: SpanKind
  // Continues the parent's trace and sampling decision. Default: a new root span.
  parent?: Span | TraceContext
  attributes?: LogAttributes
  links?: readonly SpanLink[]
  // Default now.
  startTime?: SpanTime
}

// Trace fields come together or not at all; without them the traceContext provider applies.
export type LogOptions = { eventName?: string } & (
  TraceContext | { traceId?: never; spanId?: never; traceFlags?: never }
)

export type SomLoggerBatchOptions = {
  maxBatchSize?: number
  maxQueueSize?: number
  scheduledDelayMs?: number
  // 'reject-new' (default) rejects the new log; 'drop-oldest' evicts the oldest queued log.
  overflowStrategy?: 'reject-new' | 'drop-oldest'
}

export type SomLoggerRetryOptions = {
  // Total attempts including the first. Default 3.
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
}

export type SomLoggerScope = {
  name?: string
  version?: string
  attributes?: LogAttributes
  schemaUrl?: string
}

export type SomLoggerLimits = {
  // Default 128. Excess attributes are dropped and counted in droppedAttributesCount.
  attributeCountLimit?: number
  // Default unlimited. Longer string attribute values are truncated.
  attributeValueLengthLimit?: number
  // Default 20. Deeper nested values are replaced with a placeholder string.
  maxValueDepth?: number
  // Default 128. Spans only: excess events are dropped and counted in droppedEventsCount.
  eventCountLimit?: number
  // Default 128. Spans only: excess links are dropped and counted in droppedLinksCount.
  linkCountLimit?: number
}

export type SomDiagnosticEvent =
  | { type: 'export-failed'; error: unknown; recordCount: number }
  | {
      type: 'partial-success'
      rejectedLogRecords: number
      errorMessage?: string
    }
  | { type: 'records-dropped'; reason: 'queue-full'; totalDropped: number }

export type SomLoggerOptions = {
  endpoint: string
  serviceName: string
  serviceVersion?: string
  resourceAttributes?: LogAttributes
  headers?: Readonly<Record<string, string>>
  batch?: SomLoggerBatchOptions
  fetcher?: typeof fetch
  keepalive?: boolean
  // Default true. Adds telemetry.sdk.*, user_agent.original, and browser.* attributes.
  detectResource?: boolean
  scope?: SomLoggerScope
  resourceSchemaUrl?: string
  // Default 'none'. Falls back to uncompressed where CompressionStream is missing.
  compression?: 'none' | 'gzip'
  // Per-attempt request timeout. Default 10000; 0 disables.
  timeoutMs?: number
  // Default retries up to 3 attempts; false disables.
  retry?: SomLoggerRetryOptions | false
  limits?: SomLoggerLimits
  traceContext?: TraceContextProvider
  onDiagnostic?: (event: SomDiagnosticEvent) => void
}

export type SomOptions = SomLoggerOptions & {
  // Full traces URL. Default: `endpoint` with its trailing /logs replaced by /traces.
  tracesEndpoint?: string
}
