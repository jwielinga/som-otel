import type { LogSeverity, OtlpLimits } from '../types.js'

export const OTelSeverityNumber = {
  UNSPECIFIED: 0,
  TRACE: 1,
  TRACE2: 2,
  TRACE3: 3,
  TRACE4: 4,
  DEBUG: 5,
  DEBUG2: 6,
  DEBUG3: 7,
  DEBUG4: 8,
  INFO: 9,
  INFO2: 10,
  INFO3: 11,
  INFO4: 12,
  WARN: 13,
  WARN2: 14,
  WARN3: 15,
  WARN4: 16,
  ERROR: 17,
  ERROR2: 18,
  ERROR3: 19,
  ERROR4: 20,
  FATAL: 21,
  FATAL2: 22,
  FATAL3: 23,
  FATAL4: 24,
} as const

export type OTelSeverityNumber =
  (typeof OTelSeverityNumber)[keyof typeof OTelSeverityNumber]

export const OTelLogRecordFlags = {
  TRACE_FLAGS_MASK: 0x000000ff,
} as const

export const OTelSpanKind = {
  UNSPECIFIED: 0,
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5,
} as const

export type OTelSpanKind = (typeof OTelSpanKind)[keyof typeof OTelSpanKind]

export const OTelStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const

export type OTelStatusCode =
  (typeof OTelStatusCode)[keyof typeof OTelStatusCode]

export const OTelAggregationTemporality = {
  UNSPECIFIED: 0,
  DELTA: 1,
  CUMULATIVE: 2,
} as const

export type OTelAggregationTemporality =
  (typeof OTelAggregationTemporality)[keyof typeof OTelAggregationTemporality]

export const DEFAULT_SCOPE_NAME = 'som'

export const DEFAULT_LIMITS: OtlpLimits = {
  attributeCountLimit: 128,
  attributeValueLengthLimit: Infinity,
  maxValueDepth: 20,
  eventCountLimit: 128,
  linkCountLimit: 128,
}

// Resource and scope attributes are developer-supplied, so only the depth guard applies.
export const UNLIMITED_ATTRIBUTES: OtlpLimits = {
  ...DEFAULT_LIMITS,
  attributeCountLimit: Infinity,
}

export const SEVERITY_NUMBERS: Record<LogSeverity, OTelSeverityNumber> = {
  trace: OTelSeverityNumber.TRACE,
  debug: OTelSeverityNumber.DEBUG,
  info: OTelSeverityNumber.INFO,
  warn: OTelSeverityNumber.WARN,
  error: OTelSeverityNumber.ERROR,
}

export const MIN_INT64 = -(1n << 63n)
export const MAX_INT64 = (1n << 63n) - 1n
