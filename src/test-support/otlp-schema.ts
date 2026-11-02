// A strict structural check of OTLP/JSON requests, written from the opentelemetry-proto
// message definitions and the OTLP/JSON mapping rules (hex ids, int enums, 64-bit ints as strings).
// It lists every problem it finds, so an empty list means a collector can parse the request.

type Problems = string[]
type Check = (value: unknown, path: string, problems: Problems) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scalar(
  description: string,
  isValid: (value: unknown) => boolean,
): Check {
  return (value, path, problems) => {
    if (!isValid(value)) problems.push(`${path}: expected ${description}`)
  }
}

const string = scalar('a string', (value) => typeof value === 'string')
const boolean = scalar('a boolean', (value) => typeof value === 'boolean')
const finiteNumber = scalar(
  'a finite number',
  (value) => typeof value === 'number' && Number.isFinite(value),
)
const uint32 = scalar(
  'a uint32',
  (value) =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff,
)
const uint64String = scalar(
  'a uint64 as a decimal string',
  (value) => typeof value === 'string' && /^\d{1,20}$/.test(value),
)
const int64String = scalar(
  'an int64 as a decimal string',
  (value) => typeof value === 'string' && /^-?\d{1,19}$/.test(value),
)
const base64 = scalar(
  'base64',
  (value) =>
    typeof value === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    ),
)

function hexId(length: number): Check {
  return scalar(
    `${length} hex characters, not all zero`,
    (value) =>
      typeof value === 'string' &&
      new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value) &&
      !/^0+$/.test(value),
  )
}

function enumNumber(max: number): Check {
  return scalar(
    `an enum number from 0 to ${max}`,
    (value) =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= max,
  )
}

function list(item: Check): Check {
  return (value, path, problems) => {
    if (!Array.isArray(value)) {
      problems.push(`${path}: expected an array`)
      return
    }
    value.forEach((entry, index) => item(entry, `${path}[${index}]`, problems))
  }
}

// Unknown fields are reported: a typo would be silently dropped by a collector.
function message(
  fields: Record<string, Check>,
  required: string[] = [],
): Check {
  return (value, path, problems) => {
    if (!isRecord(value)) {
      problems.push(`${path}: expected an object`)
      return
    }
    for (const name of required) {
      if (value[name] === undefined) problems.push(`${path}.${name}: required`)
    }
    for (const [name, field] of Object.entries(value)) {
      const check = fields[name]
      if (check === undefined) problems.push(`${path}.${name}: unknown field`)
      else if (field !== undefined) check(field, `${path}.${name}`, problems)
    }
  }
}

const anyValue: Check = (value, path, problems) => {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    problems.push(`${path}: expected an AnyValue with exactly one field`)
    return
  }
  message({
    stringValue: string,
    boolValue: boolean,
    intValue: int64String,
    doubleValue: finiteNumber,
    bytesValue: base64,
    arrayValue: message({ values: list(anyValue) }),
    kvlistValue: message({ values: list(keyValue) }),
  })(value, path, problems)
}

const keyValue: Check = message({ key: string, value: anyValue }, ['key'])
const attributes = list(keyValue)

const resource = message({
  attributes,
  droppedAttributesCount: uint32,
})
const scope = message(
  {
    name: string,
    version: string,
    attributes,
    droppedAttributesCount: uint32,
  },
  ['name'],
)

const spanEvent = message({
  timeUnixNano: uint64String,
  name: string,
  attributes,
  droppedAttributesCount: uint32,
})
const spanLink = message(
  {
    traceId: hexId(32),
    spanId: hexId(16),
    traceState: string,
    attributes,
    droppedAttributesCount: uint32,
    flags: uint32,
  },
  ['traceId', 'spanId'],
)
const span = message(
  {
    traceId: hexId(32),
    spanId: hexId(16),
    traceState: string,
    parentSpanId: hexId(16),
    flags: uint32,
    name: string,
    kind: enumNumber(5),
    startTimeUnixNano: uint64String,
    endTimeUnixNano: uint64String,
    attributes,
    droppedAttributesCount: uint32,
    events: list(spanEvent),
    droppedEventsCount: uint32,
    links: list(spanLink),
    droppedLinksCount: uint32,
    status: message({ message: string, code: enumNumber(2) }),
  },
  ['traceId', 'spanId', 'name', 'startTimeUnixNano', 'endTimeUnixNano'],
)

const logRecord = message({
  timeUnixNano: uint64String,
  observedTimeUnixNano: uint64String,
  severityNumber: enumNumber(24),
  severityText: string,
  body: anyValue,
  attributes,
  droppedAttributesCount: uint32,
  flags: uint32,
  traceId: hexId(32),
  spanId: hexId(16),
  eventName: string,
})

const tracesRequest = message({
  resourceSpans: list(
    message({
      resource,
      scopeSpans: list(
        message({ scope, spans: list(span), schemaUrl: string }),
      ),
      schemaUrl: string,
    }),
  ),
})

const logsRequest = message({
  resourceLogs: list(
    message({
      resource,
      scopeLogs: list(
        message({ scope, logRecords: list(logRecord), schemaUrl: string }),
      ),
      schemaUrl: string,
    }),
  ),
})

function problemsOf(check: Check, request: unknown): Problems {
  const problems: Problems = []
  check(request, 'request', problems)
  return problems
}

// An ExportTraceServiceRequest in OTLP/JSON.
export function traceRequestProblems(request: unknown): Problems {
  return problemsOf(tracesRequest, request)
}

// An ExportLogsServiceRequest in OTLP/JSON.
export function logRequestProblems(request: unknown): Problems {
  return problemsOf(logsRequest, request)
}
