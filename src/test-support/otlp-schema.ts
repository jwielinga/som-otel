// A strict structural check of OTLP/JSON requests, written from the opentelemetry-proto
// message definitions and the OTLP/JSON mapping rules (hex ids, int enums, 64-bit ints as strings).
// It lists every problem it finds, so an empty list means a collector can parse the request.

type Problems = string[]
type Check = (value: unknown, path: string, problems: Problems) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A uint64 decimal string as a number we can compare; anything else is left to the type checks.
function toBigInt(value: unknown): bigint | undefined {
  return typeof value === 'string' && /^\d{1,20}$/.test(value)
    ? BigInt(value)
    : undefined
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
const spanFields = message(
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

const span: Check = (value, path, problems) => {
  spanFields(value, path, problems)
  if (!isRecord(value)) return
  const start = toBigInt(value.startTimeUnixNano)
  const end = toBigInt(value.endTimeUnixNano)
  if (start !== undefined && end !== undefined && end < start) {
    problems.push(
      `${path}: endTimeUnixNano must not be before startTimeUnixNano`,
    )
  }
}

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

// Exactly one of asInt / asDouble must be set.
const numberDataPoint: Check = (value, path, problems) => {
  message({
    attributes,
    startTimeUnixNano: uint64String,
    timeUnixNano: uint64String,
    asDouble: finiteNumber,
    asInt: int64String,
    flags: uint32,
  })(value, path, problems)
  if (!isRecord(value)) return
  if ((value.asInt === undefined) === (value.asDouble === undefined)) {
    problems.push(`${path}: expected exactly one of asInt or asDouble`)
  }
}

// The bucket counts must add up to the count and number one more than the bounds.
const histogramDataPoint: Check = (value, path, problems) => {
  message({
    attributes,
    startTimeUnixNano: uint64String,
    timeUnixNano: uint64String,
    count: uint64String,
    sum: finiteNumber,
    bucketCounts: list(uint64String),
    explicitBounds: list(finiteNumber),
    min: finiteNumber,
    max: finiteNumber,
    flags: uint32,
  })(value, path, problems)
  if (!isRecord(value)) return

  const { min, max, sum } = value
  if (typeof min === 'number' && typeof max === 'number') {
    if (min > max) problems.push(`${path}: min must not exceed max`)

    // With only non-negative values, the sum lies between count * min and count * max.
    if (typeof sum === 'number' && min >= 0) {
      const count = Number(value.count)
      const slack = 1e-9 * Math.max(1, Math.abs(sum))
      if (sum < min * count - slack || sum > max * count + slack) {
        problems.push(
          `${path}: sum must lie between count * min and count * max`,
        )
      }
    }
  }

  const counts = value.bucketCounts
  const bounds = value.explicitBounds
  if (!Array.isArray(counts) || !Array.isArray(bounds)) return
  if (counts.length !== bounds.length + 1) {
    problems.push(`${path}: expected one more bucketCounts than explicitBounds`)
  }
  const total = counts.reduce((sum, count) => sum + Number(count), 0)
  if (String(total) !== value.count) {
    problems.push(`${path}: bucketCounts must add up to count`)
  }
  const ascending = bounds.every(
    (bound, index) => index === 0 || bound > (bounds[index - 1] as number),
  )
  if (!ascending) problems.push(`${path}: explicitBounds must be ascending`)
}

const temporality = enumNumber(2)

function forEachPoint(
  points: unknown,
  path: string,
  visit: (point: Record<string, unknown>, pointPath: string) => void,
): void {
  if (!Array.isArray(points)) return
  points.forEach((point, index) => {
    if (isRecord(point)) visit(point, `${path}.dataPoints[${index}]`)
  })
}

// Every point needs a time; a delta point also needs a start, and no window runs backwards.
function checkWindows(
  points: unknown,
  path: string,
  problems: Problems,
  needsStart: boolean,
): void {
  forEachPoint(points, path, (point, pointPath) => {
    if (point.timeUnixNano === undefined) {
      problems.push(`${pointPath}.timeUnixNano: required`)
    }
    if (needsStart && point.startTimeUnixNano === undefined) {
      problems.push(
        `${pointPath}.startTimeUnixNano: required for a delta point`,
      )
    }
    const start = toBigInt(point.startTimeUnixNano)
    const end = toBigInt(point.timeUnixNano)
    if (start !== undefined && end !== undefined && start > end) {
      problems.push(
        `${pointPath}: startTimeUnixNano must not be after timeUnixNano`,
      )
    }
  })
}

// A stream is told apart by its attributes, so two points of one metric must differ in them.
function checkDistinctSeries(
  points: unknown,
  path: string,
  problems: Problems,
): void {
  const seen = new Set<string>()
  forEachPoint(points, path, (point, pointPath) => {
    const entries = Array.isArray(point.attributes) ? point.attributes : []
    const id = JSON.stringify(
      [...entries].sort((a, b) => String(a?.key).localeCompare(String(b?.key))),
    )
    if (seen.has(id))
      problems.push(`${pointPath}: duplicate data point for these attributes`)
    seen.add(id)
  })
}

function checkTemporality(
  value: Record<string, unknown>,
  path: string,
  problems: Problems,
): boolean {
  const delta = value.aggregationTemporality === 1
  if (!delta && value.aggregationTemporality !== 2) {
    problems.push(
      `${path}.aggregationTemporality: expected delta (1) or cumulative (2)`,
    )
  }
  return delta
}

const gauge: Check = (value, path, problems) => {
  message({ dataPoints: list(numberDataPoint) })(value, path, problems)
  if (!isRecord(value)) return
  checkWindows(value.dataPoints, path, problems, false)
  checkDistinctSeries(value.dataPoints, path, problems)
}

const sum: Check = (value, path, problems) => {
  message({
    dataPoints: list(numberDataPoint),
    aggregationTemporality: temporality,
    isMonotonic: boolean,
  })(value, path, problems)
  if (!isRecord(value)) return

  checkWindows(
    value.dataPoints,
    path,
    problems,
    checkTemporality(value, path, problems),
  )
  checkDistinctSeries(value.dataPoints, path, problems)
  if (value.isMonotonic === true) {
    forEachPoint(value.dataPoints, path, (point, pointPath) => {
      if (Number(point.asInt ?? point.asDouble) < 0) {
        problems.push(`${pointPath}: a monotonic sum must not be negative`)
      }
    })
  }
}

const histogram: Check = (value, path, problems) => {
  message({
    dataPoints: list(histogramDataPoint),
    aggregationTemporality: temporality,
  })(value, path, problems)
  if (!isRecord(value)) return

  checkWindows(
    value.dataPoints,
    path,
    problems,
    checkTemporality(value, path, problems),
  )
  checkDistinctSeries(value.dataPoints, path, problems)
}

const METRIC_DATA = ['gauge', 'sum', 'histogram'] as const

const metric: Check = (value, path, problems) => {
  message(
    {
      name: string,
      description: string,
      unit: string,
      gauge,
      sum,
      histogram,
    },
    ['name'],
  )(value, path, problems)
  if (!isRecord(value)) return

  if (value.name === '')
    problems.push(`${path}.name: expected a non-empty string`)
  if (METRIC_DATA.filter((kind) => value[kind] !== undefined).length !== 1) {
    problems.push(`${path}: expected exactly one of gauge, sum or histogram`)
  }
}

// One request must not hold two metrics that a collector would treat as the same stream.
const scopeMetrics: Check = (value, path, problems) => {
  message({ scope, metrics: list(metric), schemaUrl: string })(
    value,
    path,
    problems,
  )
  if (!isRecord(value) || !Array.isArray(value.metrics)) return

  const seen = new Set<string>()
  value.metrics.forEach((entry, index) => {
    if (!isRecord(entry)) return
    const kind = METRIC_DATA.find((name) => entry[name] !== undefined)
    const id = JSON.stringify([entry.name, entry.unit ?? '', kind])
    if (seen.has(id)) {
      problems.push(
        `${path}.metrics[${index}]: duplicate metric ${String(entry.name)}`,
      )
    }
    seen.add(id)
  })
}

const metricsRequest = message({
  resourceMetrics: list(
    message({
      resource,
      scopeMetrics: list(scopeMetrics),
      schemaUrl: string,
    }),
  ),
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

// An ExportMetricsServiceRequest in OTLP/JSON.
export function metricRequestProblems(request: unknown): Problems {
  return problemsOf(metricsRequest, request)
}
