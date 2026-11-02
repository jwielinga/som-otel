import { nowUnixNano } from '../utils/clock.js'
import { validTraceFields } from '../traces/trace-ids.js'
import type {
  OTelJsonAnyValue,
  OTelJsonInstrumentationScope,
  OTelJsonKeyValue,
  OTelJsonLogsData,
  OTelJsonResource,
  OTelJsonResourceLogs,
  OTelLogRecord,
  EncodeContext,
  LogAttributes,
  LogAttributeValue,
  OtlpLimits,
  OtlpLogRecord,
  LogSeverity,
  OtlpRecordExtras,
  SomLoggerScope,
  OtlpRequestOptions,
  SomLoggerLimits,
} from '../types.js'
import {
  DEFAULT_LIMITS,
  DEFAULT_SCOPE_NAME,
  MAX_INT64,
  MIN_INT64,
  SEVERITY_NUMBERS,
  UNLIMITED_ATTRIBUTES,
} from './otlp.constants.js'

export function resolveLimits(limits: SomLoggerLimits = {}): OtlpLimits {
  return {
    attributeCountLimit:
      limits.attributeCountLimit ?? DEFAULT_LIMITS.attributeCountLimit,
    attributeValueLengthLimit:
      limits.attributeValueLengthLimit ??
      DEFAULT_LIMITS.attributeValueLengthLimit,
    maxValueDepth: limits.maxValueDepth ?? DEFAULT_LIMITS.maxValueDepth,
    eventCountLimit: limits.eventCountLimit ?? DEFAULT_LIMITS.eventCountLimit,
    linkCountLimit: limits.linkCountLimit ?? DEFAULT_LIMITS.linkCountLimit,
  }
}

function encodeBytes(value: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  // Avoid cutting a surrogate pair in half.
  const lastCode = limit > 0 ? text.charCodeAt(limit - 1) : 0
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? limit - 1 : limit
  return text.slice(0, end)
}

export function describeError(error: Error): {
  type: string
  message: string
  stacktrace?: string
} {
  const type =
    error.name !== 'Error' && error.name
      ? error.name
      : error.constructor?.name || 'Error'
  return {
    type,
    message: error.message,
    ...(error.stack ? { stacktrace: error.stack } : {}),
  }
}

function createContext(
  limits: OtlpLimits,
  truncateStrings: boolean,
): EncodeContext {
  return {
    stringLimit: truncateStrings ? limits.attributeValueLengthLimit : Infinity,
    maxDepth: limits.maxValueDepth,
    ancestors: [],
  }
}

// JS has one number type: safe integers map to int_value (as the OTel JS SDK does), the rest to double_value.
function encodeNumber(value: number, key: string): OTelJsonAnyValue {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Log attribute "${key}" must be a finite number.`)
  }
  return Number.isSafeInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value }
}

function encodeValue(
  value: LogAttributeValue,
  key: string,
  context: EncodeContext,
  depth = 0,
): OTelJsonAnyValue {
  if (typeof value === 'string') {
    return { stringValue: truncate(value, context.stringLimit) }
  }
  if (typeof value === 'boolean') return { boolValue: value }

  if (typeof value === 'number') return encodeNumber(value, key)

  if (typeof value === 'bigint') {
    if (value < MIN_INT64 || value > MAX_INT64) {
      throw new TypeError(`Log attribute "${key}" must fit in a signed int64.`)
    }
    return { intValue: value.toString() }
  }

  if (value instanceof Uint8Array) return { bytesValue: encodeBytes(value) }

  if (value instanceof Error) return encodeError(value, context)

  if (depth >= context.maxDepth) return { stringValue: '[MaxDepthExceeded]' }
  if (context.ancestors.includes(value)) return { stringValue: '[Circular]' }

  context.ancestors.push(value)
  try {
    return encodeContainer(value, key, context, depth)
  } finally {
    context.ancestors.pop()
  }
}

function encodeError(error: Error, context: EncodeContext): OTelJsonAnyValue {
  const { type, message, stacktrace } = describeError(error)
  const fields = Object.entries({ type, message, stacktrace }).flatMap(
    ([fieldKey, text]) =>
      text === undefined
        ? []
        : [
            {
              key: fieldKey,
              value: { stringValue: truncate(text, context.stringLimit) },
            },
          ],
  )
  return { kvlistValue: { values: fields } }
}

function encodeContainer(
  value: Exclude<LogAttributeValue, string | number | boolean | bigint | Error>,
  key: string,
  context: EncodeContext,
  depth: number,
): OTelJsonAnyValue {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => encodeValue(item, key, context, depth + 1)),
      },
    }
  }

  return {
    kvlistValue: {
      values: Object.entries(value).map(([nestedKey, nestedValue]) => ({
        key: nestedKey,
        value: encodeValue(
          nestedValue,
          `${key}.${nestedKey}`,
          context,
          depth + 1,
        ),
      })),
    },
  }
}

export function encodeAttributes(
  attributes: LogAttributes,
  limits: OtlpLimits,
): { values: OTelJsonKeyValue[]; dropped: number } {
  const entries = Object.entries(attributes)
  const kept = entries.slice(0, limits.attributeCountLimit)
  const context = createContext(limits, true)

  return {
    values: kept.map(([key, value]) => ({
      key,
      value: encodeValue(value, key, context),
    })),
    dropped: entries.length - kept.length,
  }
}

// An Error body becomes its message, with the details as exception.* attributes.
function splitErrorBody(
  body: LogAttributeValue,
  attributes: LogAttributes,
): { bodyValue: LogAttributeValue; recordAttributes: LogAttributes } {
  if (!(body instanceof Error)) {
    return { bodyValue: body, recordAttributes: attributes }
  }

  const { type, message, stacktrace } = describeError(body)
  return {
    bodyValue: message || type,
    recordAttributes: {
      'exception.type': type,
      'exception.message': message,
      ...(stacktrace === undefined
        ? {}
        : { 'exception.stacktrace': stacktrace }),
      ...attributes,
    },
  }
}

export function createOtlpLogRecord(
  severity: LogSeverity,
  body: LogAttributeValue,
  attributes: LogAttributes,
  extras: OtlpRecordExtras = {},
  limits: OtlpLimits = DEFAULT_LIMITS,
): OtlpLogRecord {
  const now = nowUnixNano().toString()
  const { bodyValue, recordAttributes } = splitErrorBody(body, attributes)
  const encoded = encodeAttributes(recordAttributes, limits)
  return {
    timeUnixNano: now,
    observedTimeUnixNano: now,
    severityNumber: SEVERITY_NUMBERS[severity],
    severityText: severity.toUpperCase(),
    body: encodeValue(bodyValue, 'body', createContext(limits, false)),
    attributes: encoded.values,
    droppedAttributesCount: encoded.dropped || undefined,
    flags: extras.flags,
    ...validTraceFields(extras),
    eventName: extras.eventName,
  }
}

export function encodeOtlpLogRecord(
  record: OTelLogRecord,
  limits: OtlpLimits = DEFAULT_LIMITS,
): OtlpLogRecord {
  const encoded =
    record.attributes === undefined
      ? undefined
      : encodeAttributes(record.attributes, limits)
  const dropped = (record.droppedAttributesCount ?? 0) + (encoded?.dropped ?? 0)

  return {
    timeUnixNano: record.timeUnixNano?.toString(),
    observedTimeUnixNano: record.observedTimeUnixNano?.toString(),
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body:
      record.body === undefined
        ? undefined
        : encodeValue(record.body, 'body', createContext(limits, false)),
    attributes: encoded?.values,
    droppedAttributesCount:
      dropped === 0 ? record.droppedAttributesCount : dropped,
    flags: record.flags,
    ...validTraceFields(record),
    eventName: record.eventName,
  }
}

function encodeScope(
  scope: SomLoggerScope | undefined,
): OTelJsonInstrumentationScope {
  const encoded: OTelJsonInstrumentationScope = {
    name: scope?.name ?? DEFAULT_SCOPE_NAME,
  }
  if (scope?.version !== undefined) encoded.version = scope.version
  if (scope?.attributes !== undefined) {
    encoded.attributes = encodeAttributes(
      scope.attributes,
      UNLIMITED_ATTRIBUTES,
    ).values
  }
  return encoded
}

function withSchemaUrl(schemaUrl: string | undefined): { schemaUrl?: string } {
  return schemaUrl === undefined ? {} : { schemaUrl }
}

// The resource part of a request, shared by every signal.
export function resourceEnvelope(
  resourceAttributes: LogAttributes,
  options: OtlpRequestOptions,
): { resource: OTelJsonResource; schemaUrl?: string } {
  return {
    resource: {
      attributes: encodeAttributes(resourceAttributes, UNLIMITED_ATTRIBUTES)
        .values,
    },
    ...withSchemaUrl(options.resourceSchemaUrl),
  }
}

// The scope part of a request, shared by every signal.
export function scopeEnvelope(options: OtlpRequestOptions): {
  scope: OTelJsonInstrumentationScope
  schemaUrl?: string
} {
  return {
    scope: encodeScope(options.scope),
    ...withSchemaUrl(options.scope?.schemaUrl),
  }
}

export function createOtlpLogsRequest(
  resourceAttributes: LogAttributes,
  logRecords: readonly OtlpLogRecord[],
  options: OtlpRequestOptions = {},
): OTelJsonLogsData {
  const resourceLogs: OTelJsonResourceLogs = {
    ...resourceEnvelope(resourceAttributes, options),
    scopeLogs: [{ ...scopeEnvelope(options), logRecords: [...logRecords] }],
  }

  return { resourceLogs: [resourceLogs] }
}
