import type {
  OTelAggregationTemporality,
  OTelSeverityNumber,
  OTelSpanKind,
  OTelStatusCode,
} from './otlp/otlp.constants.js'
import type { Span } from './traces/span.js'

// ---- OTLP data model ----

export type OTelTraceId = string
export type OTelSpanId = string
export type OTelTraceFlags = number
export type OTelTimestamp = bigint

export type OTelAnyValue =
  | string
  | boolean
  | number
  | bigint
  | Uint8Array
  | OTelAnyValue[]
  | { [key: string]: OTelAnyValue }

export type OTelAttributes = Record<string, OTelAnyValue>

export type OTelEntityRef = {
  key: string
  id: OTelAnyValue
}

export type OTelResource = {
  attributes?: OTelAttributes
  droppedAttributesCount?: number
  entityRefs?: OTelEntityRef[]
}

export type OTelInstrumentationScope = {
  name?: string
  version?: string
  attributes?: OTelAttributes
  droppedAttributesCount?: number
}

export type OTelLogRecordFlagsValue = number

export type OTelLogRecord = {
  timeUnixNano?: OTelTimestamp
  observedTimeUnixNano?: OTelTimestamp
  severityNumber?: OTelSeverityNumber
  severityText?: string
  body?: OTelAnyValue
  attributes?: OTelAttributes
  droppedAttributesCount?: number
  flags?: OTelLogRecordFlagsValue
  traceId?: OTelTraceId
  spanId?: OTelSpanId
  eventName?: string
}

export type OTelScopeLogs = {
  scope?: OTelInstrumentationScope
  schemaUrl?: string
  logRecords?: OTelLogRecord[]
}

export type OTelResourceLogs = {
  resource?: OTelResource
  scopeLogs?: OTelScopeLogs[]
  schemaUrl?: string
}

export type OTelLogsData = {
  resourceLogs?: OTelResourceLogs[]
}

export type OTelLogs = OTelLogRecord[]
export type OTelExportLogsServiceRequest = OTelLogsData

export type OTelJsonUint64 = string
export type OTelJsonTraceId = string
export type OTelJsonSpanId = string

export type OTelJsonAnyValue = {
  stringValue?: string
  boolValue?: boolean
  intValue?: OTelJsonUint64
  doubleValue?: number
  bytesValue?: string
  arrayValue?: OTelJsonArrayValue
  kvlistValue?: OTelJsonKeyValueList
}

export type OTelJsonArrayValue = {
  values?: OTelJsonAnyValue[]
}

export type OTelJsonKeyValueList = {
  values?: OTelJsonKeyValue[]
}

export type OTelJsonKeyValue = {
  key: string
  value?: OTelJsonAnyValue
}

export type OTelJsonResource = {
  attributes?: OTelJsonKeyValue[]
  droppedAttributesCount?: number
  entityRefs?: OTelJsonEntityRef[]
}

export type OTelJsonEntityRef = {
  key: string
  id?: OTelJsonAnyValue
}

export type OTelJsonInstrumentationScope = {
  name?: string
  version?: string
  attributes?: OTelJsonKeyValue[]
  droppedAttributesCount?: number
}

export type OTelJsonScopeLogs = {
  scope?: OTelJsonInstrumentationScope
  logRecords?: OTelJsonLogRecord[]
  schemaUrl?: string
}

export type OTelJsonResourceLogs = {
  resource?: OTelJsonResource
  scopeLogs?: OTelJsonScopeLogs[]
  schemaUrl?: string
}

export type OTelJsonLogRecord = {
  timeUnixNano?: OTelJsonUint64
  observedTimeUnixNano?: OTelJsonUint64
  severityNumber?: OTelSeverityNumber
  severityText?: string
  body?: OTelJsonAnyValue
  attributes?: OTelJsonKeyValue[]
  droppedAttributesCount?: number
  flags?: number
  traceId?: OTelJsonTraceId
  spanId?: OTelJsonSpanId
  eventName?: string
}

export type OTelJsonLogsData = {
  resourceLogs?: OTelJsonResourceLogs[]
}

export type OTelJsonExportLogsServiceRequest = OTelJsonLogsData

export type OTelApplicationLog = OTelLogRecord & {
  body?: string | Record<string, OTelAnyValue>
}

export type OTelEvent = OTelLogRecord & {
  eventName: string
}

export type OTelSimpleLog = OTelLogRecord & {
  body?: string
}

export type OTelJsonStatus = {
  message?: string
  code?: OTelStatusCode
}

export type OTelJsonSpanEvent = {
  timeUnixNano?: OTelJsonUint64
  name?: string
  attributes?: OTelJsonKeyValue[]
  droppedAttributesCount?: number
}

export type OTelJsonSpanLink = {
  traceId?: OTelJsonTraceId
  spanId?: OTelJsonSpanId
  traceState?: string
  attributes?: OTelJsonKeyValue[]
  droppedAttributesCount?: number
  flags?: number
}

export type OTelJsonSpan = {
  traceId?: OTelJsonTraceId
  spanId?: OTelJsonSpanId
  traceState?: string
  parentSpanId?: OTelJsonSpanId
  flags?: number
  name?: string
  kind?: OTelSpanKind
  startTimeUnixNano?: OTelJsonUint64
  endTimeUnixNano?: OTelJsonUint64
  attributes?: OTelJsonKeyValue[]
  droppedAttributesCount?: number
  events?: OTelJsonSpanEvent[]
  droppedEventsCount?: number
  links?: OTelJsonSpanLink[]
  droppedLinksCount?: number
  status?: OTelJsonStatus
}

export type OTelJsonScopeSpans = {
  scope?: OTelJsonInstrumentationScope
  spans?: OTelJsonSpan[]
  schemaUrl?: string
}

export type OTelJsonResourceSpans = {
  resource?: OTelJsonResource
  scopeSpans?: OTelJsonScopeSpans[]
  schemaUrl?: string
}

export type OTelJsonTracesData = {
  resourceSpans?: OTelJsonResourceSpans[]
}

export type OTelJsonExportTraceServiceRequest = OTelJsonTracesData

export type OTelJsonNumberDataPoint = {
  attributes?: OTelJsonKeyValue[]
  startTimeUnixNano?: OTelJsonUint64
  timeUnixNano?: OTelJsonUint64
  // Exactly one of asInt (int64 string) or asDouble is set.
  asInt?: string
  asDouble?: number
}

export type OTelJsonSum = {
  dataPoints?: OTelJsonNumberDataPoint[]
  aggregationTemporality?: OTelAggregationTemporality
  isMonotonic?: boolean
}

export type OTelJsonGauge = {
  dataPoints?: OTelJsonNumberDataPoint[]
}

export type OTelJsonMetric = {
  name?: string
  description?: string
  unit?: string
  sum?: OTelJsonSum
  gauge?: OTelJsonGauge
}

export type OTelJsonScopeMetrics = {
  scope?: OTelJsonInstrumentationScope
  metrics?: OTelJsonMetric[]
  schemaUrl?: string
}

export type OTelJsonResourceMetrics = {
  resource?: OTelJsonResource
  scopeMetrics?: OTelJsonScopeMetrics[]
  schemaUrl?: string
}

export type OTelJsonMetricsData = {
  resourceMetrics?: OTelJsonResourceMetrics[]
}

export type OTelJsonExportMetricsServiceRequest = OTelJsonMetricsData

// ---- Public SDK ----

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
export type SpanContext = Required<TraceContext>

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
// `span` is shorthand for the span's own trace fields and cannot be combined with them.
type NoTraceFields = { traceId?: never; spanId?: never; traceFlags?: never }

export type LogOptions = { eventName?: string } & (
  (TraceContext & { span?: never }) | (NoTraceFields & { span?: Span })
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

export type SomSignal = 'logs' | 'traces' | 'metrics'

export type SomDiagnosticEvent =
  | {
      type: 'export-failed'
      signal: SomSignal
      error: unknown
      recordCount: number
    }
  | {
      type: 'partial-success'
      signal: 'logs'
      rejectedLogRecords: number
      errorMessage?: string
    }
  | {
      type: 'partial-success'
      signal: 'traces'
      rejectedSpans: number
      errorMessage?: string
    }
  | {
      type: 'partial-success'
      signal: 'metrics'
      rejectedDataPoints: number
      errorMessage?: string
    }
  | {
      type: 'records-dropped'
      signal: SomSignal
      reason: 'queue-full'
      totalDropped: number
    }

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
  // Full metrics URL. Default: `endpoint` with its trailing /logs replaced by /metrics.
  metricsEndpoint?: string
}

// ---- OTLP encoding ----

export type OtlpLogRecord = OTelJsonLogRecord

export type OtlpSpan = OTelJsonSpan

// Attribute values on a measurement follow the same rules as log attributes.
export type MetricAttributes = LogAttributes

export type InstrumentOptions = {
  description?: string
  unit?: string
}

export type MetricKind = 'counter' | 'up-down-counter' | 'gauge'

export type MetricDescriptor = InstrumentOptions & {
  name: string
  kind: MetricKind
}

// One queued instrument call; the encoder collapses a batch of these into data points.
export type OtlpMeasurement = {
  descriptor: MetricDescriptor
  value: number
  timeUnixNano: bigint
  attributes: OTelJsonKeyValue[]
}

export type OtlpLimits = Required<SomLoggerLimits>

export type OtlpRecordExtras = {
  traceId?: string
  spanId?: string
  flags?: number
  eventName?: string
}

export type OtlpRequestOptions = {
  scope?: SomLoggerScope
  resourceSchemaUrl?: string
}

export type EncodeContext = {
  stringLimit: number
  maxDepth: number
  ancestors: object[]
}

export type PartialSuccess = {
  rejectedLogRecords: number
  errorMessage?: string
}

export type TracePartialSuccess = {
  rejectedSpans: number
  errorMessage?: string
}

export type MetricPartialSuccess = {
  rejectedDataPoints: number
  errorMessage?: string
}

export type JsonExportResponse = {
  partialSuccess?: {
    // OTLP/JSON encodes int64 as a string.
    rejectedLogRecords?: string | number
    rejectedSpans?: string | number
    rejectedDataPoints?: string | number
    errorMessage?: string
  }
}

export type RejectedKey =
  'rejectedLogRecords' | 'rejectedSpans' | 'rejectedDataPoints'

export type Rejection = { rejected: number; errorMessage: string | undefined }

// ---- Transport ----

export type RetryPolicy = Required<SomLoggerRetryOptions>

export type Body = string | Uint8Array<ArrayBuffer>

export type Payload = {
  body: Body
  contentEncoding?: 'gzip'
}

export type OtlpTransportOptions<TItem, TPartial> = {
  endpoint: string
  // Names the signal in error messages.
  signal: SomSignal
  encode: (items: readonly TItem[]) => string
  readPartialSuccess: (response: Response) => Promise<TPartial | undefined>
  headers?: Readonly<Record<string, string>>
  fetcher: typeof fetch
  keepalive?: boolean
  compression?: 'none' | 'gzip'
  // Per-attempt timeout; unset or 0 disables.
  timeoutMs?: number
  // Unset means a single attempt.
  retry?: RetryPolicy
  onPartialSuccess?: (partial: TPartial) => void
}

export type OtlpHttpExporterOptions = OtlpRequestOptions & {
  endpoint: string
  resourceAttributes: LogAttributes
  headers?: Readonly<Record<string, string>>
  fetcher: typeof fetch
  keepalive?: boolean
  compression?: 'none' | 'gzip'
  // Per-attempt timeout; unset or 0 disables.
  timeoutMs?: number
  // Unset means a single attempt.
  retry?: RetryPolicy
  onPartialSuccess?: (partial: PartialSuccess) => void
}

export type PendingItem<T> = {
  item: T
  resolve: () => void
  reject: (error: unknown) => void
}

export type LogBatcherOptions<T> = SomLoggerBatchOptions & {
  sendBatch: (items: readonly T[]) => Promise<void>
  // Used by flushOnUnload(); defaults to sendBatch.
  sendBatchOnUnload?: (items: readonly T[]) => Promise<void>
  onDropped?: (totalDropped: number) => void
  // Names the batcher in error messages. Default 'logs'.
  signal?: SomSignal
}

export type Unloadable = { flushOnUnload(): Promise<void> }

// ---- Logs and traces ----

export type SomLoggerInit = {
  limits?: OtlpLimits
  traceContext?: TraceContextProvider
  onShutdown?: () => void
}

export type SomMeterInit = {
  limits?: OtlpLimits
  // Called when a measurement cannot be encoded; instrument calls themselves never throw.
  onError?: (error: unknown) => void
  onShutdown?: () => void
}

export type SomTracerInit = {
  limits?: OtlpLimits
  // Called when a span cannot be encoded; end() itself never throws.
  onError?: (error: unknown) => void
  onShutdown?: () => void
}

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

export type ResolvedSpanContext = {
  context: SpanContext
  parentSpanId: string | undefined
  // False when the parent's trace flags say the trace is not sampled.
  sampled: boolean
}

export type OTelApiLike<TContext> = {
  trace: {
    getSpanContext(
      context: TContext,
    ): { traceId: string; spanId: string; traceFlags: number } | undefined
  }
  context: { active(): TContext }
}

// ---- SDK internals ----

export type Emit = (event: SomDiagnosticEvent) => void

// What the batcher needs from an exporter, whatever the signal.
export type BatchExporter<T> = {
  export(items: readonly T[]): Promise<void>
  exportOnUnload(items: readonly T[]): Promise<void>
  splitForUnload(items: readonly T[]): T[][]
}

export type NavigatorUAData = {
  brands?: ReadonlyArray<{ brand: string; version: string }>
  mobile?: boolean
  platform?: string
}
