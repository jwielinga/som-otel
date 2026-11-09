import { nowUnixNano } from '../utils/clock.js'
import type {
  LogAttributes,
  MetricAttributes,
  MetricDescriptor,
  OTelJsonKeyValue,
  OTelJsonHistogramDataPoint,
  OTelJsonMetric,
  OTelJsonMetricsData,
  OTelJsonNumberDataPoint,
  OtlpLimits,
  OtlpMeasurement,
  OtlpRequestOptions,
} from '../types.js'
import {
  encodeAttributes,
  resourceEnvelope,
  scopeEnvelope,
} from './encode-logs.js'
import { DEFAULT_LIMITS, OTelAggregationTemporality } from './otlp.constants.js'

export function createOtlpMeasurement(
  descriptor: MetricDescriptor,
  value: number,
  attributes: MetricAttributes,
  limits: OtlpLimits = DEFAULT_LIMITS,
): OtlpMeasurement {
  return {
    descriptor,
    value,
    timeUnixNano: nowUnixNano(),
    attributes: encodeAttributes(attributes, limits).values,
  }
}

type Series = {
  attributes: OTelJsonKeyValue[]
  start: bigint
  end: bigint
  total: number
  allIntegers: boolean
  last: number
  values: number[]
}

// Attribute order must not split a series.
function seriesKey(attributes: OTelJsonKeyValue[]): string {
  return JSON.stringify(
    [...attributes].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
  )
}

function metricKey({
  kind,
  name,
  unit,
  description,
  boundaries,
}: MetricDescriptor): string {
  return JSON.stringify([kind, name, unit, description, boundaries])
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const group = groups.get(id)
    if (group) group.push(item)
    else groups.set(id, [item])
  }
  return [...groups.values()]
}

function collapseSeries(measurements: readonly OtlpMeasurement[]): Series[] {
  return groupBy(measurements, (m) => seriesKey(m.attributes)).map((group) => ({
    attributes: group[0]!.attributes,
    start: group.reduce(
      (min, m) => (m.timeUnixNano < min ? m.timeUnixNano : min),
      group[0]!.timeUnixNano,
    ),
    end: group.reduce(
      (max, m) => (m.timeUnixNano > max ? m.timeUnixNano : max),
      group[0]!.timeUnixNano,
    ),
    total: group.reduce((sum, m) => sum + m.value, 0),
    allIntegers: group.every((m) => Number.isInteger(m.value)),
    last: group.reduce((latest, m) =>
      m.timeUnixNano >= latest.timeUnixNano ? m : latest,
    ).value,
    values: group.map((m) => m.value),
  }))
}

function numberValue(
  total: number,
  allIntegers: boolean,
): Pick<OTelJsonNumberDataPoint, 'asInt' | 'asDouble'> {
  return allIntegers && Number.isSafeInteger(total)
    ? { asInt: String(total) }
    : { asDouble: total }
}

// Buckets are upper-inclusive: a value on a bound belongs to the bucket that ends at it.
function histogramValues(
  values: readonly number[],
  bounds: number[],
): Omit<
  OTelJsonHistogramDataPoint,
  'attributes' | 'startTimeUnixNano' | 'timeUnixNano'
> {
  const counts = new Array<number>(bounds.length + 1).fill(0)
  for (const value of values) {
    const index = bounds.findIndex((bound) => value <= bound)
    counts[index === -1 ? bounds.length : index]!++
  }

  return {
    count: String(values.length),
    // OTLP: a sum is only meaningful when every value is non-negative.
    ...(values.some((value) => value < 0)
      ? {}
      : { sum: values.reduce((total, value) => total + value, 0) }),
    bucketCounts: counts.map(String),
    explicitBounds: bounds,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function encodeMetric(
  descriptor: MetricDescriptor,
  measurements: readonly OtlpMeasurement[],
): OTelJsonMetric {
  const series = collapseSeries(measurements)
  const identity = {
    name: descriptor.name,
    description: descriptor.description,
    unit: descriptor.unit,
  }
  const attributesOf = (s: Series) =>
    s.attributes.length > 0 ? s.attributes : undefined

  if (descriptor.kind === 'histogram') {
    const bounds = [...(descriptor.boundaries ?? [])]
    return {
      ...identity,
      histogram: {
        dataPoints: series.map((s): OTelJsonHistogramDataPoint => ({
          attributes: attributesOf(s),
          startTimeUnixNano: s.start.toString(),
          timeUnixNano: s.end.toString(),
          ...histogramValues(s.values, bounds),
        })),
        aggregationTemporality: OTelAggregationTemporality.DELTA,
      },
    }
  }

  if (descriptor.kind === 'gauge') {
    return {
      ...identity,
      gauge: {
        dataPoints: series.map((s): OTelJsonNumberDataPoint => ({
          attributes: attributesOf(s),
          timeUnixNano: s.end.toString(),
          ...numberValue(s.last, Number.isInteger(s.last)),
        })),
      },
    }
  }

  return {
    ...identity,
    sum: {
      dataPoints: series.map((s): OTelJsonNumberDataPoint => ({
        attributes: attributesOf(s),
        startTimeUnixNano: s.start.toString(),
        timeUnixNano: s.end.toString(),
        ...numberValue(s.total, s.allIntegers),
      })),
      aggregationTemporality: OTelAggregationTemporality.DELTA,
      isMonotonic: descriptor.kind === 'counter',
    },
  }
}

// Collapses a batch of measurements into delta data points, one per metric and attribute set.
// TODO(metrics): cumulative temporality, exponential histograms, and exemplars are not supported yet.
export function createOtlpMetricsRequest(
  resourceAttributes: LogAttributes,
  measurements: readonly OtlpMeasurement[],
  options: OtlpRequestOptions = {},
): OTelJsonMetricsData {
  const metrics = groupBy(measurements, (m) => metricKey(m.descriptor)).map(
    (group) => encodeMetric(group[0]!.descriptor, group),
  )

  return {
    resourceMetrics: [
      {
        ...resourceEnvelope(resourceAttributes, options),
        scopeMetrics: [{ ...scopeEnvelope(options), metrics }],
      },
    ],
  }
}
