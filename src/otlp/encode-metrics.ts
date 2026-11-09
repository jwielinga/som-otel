import type { SeriesClock } from '../metrics/series-clock.js'
import { nowUnixNano } from '../utils/clock.js'
import type {
  LogAttributes,
  MetricAttributes,
  MetricDescriptor,
  MetricSeries,
  OTelJsonAnyValue,
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

function byKey(a: OTelJsonKeyValue, b: OTelJsonKeyValue): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

// Map entries are ordered at every depth; array elements keep their order.
function canonicalValue(
  value: OTelJsonAnyValue | undefined,
): OTelJsonAnyValue | undefined {
  if (value?.kvlistValue) {
    return {
      kvlistValue: {
        values: canonicalAttributes(value.kvlistValue.values ?? []),
      },
    }
  }
  if (value?.arrayValue) {
    return {
      arrayValue: {
        values: (value.arrayValue.values ?? []).map(
          (item) => canonicalValue(item) ?? item,
        ),
      },
    }
  }
  return value
}

function canonicalAttributes(
  attributes: OTelJsonKeyValue[],
): OTelJsonKeyValue[] {
  return [...attributes]
    .sort(byKey)
    .map(({ key, value }) => ({ key, value: canonicalValue(value) }))
}

// Attribute order must not split a series.
export function seriesKey(attributes: OTelJsonKeyValue[]): string {
  return JSON.stringify(canonicalAttributes(attributes))
}

// Instruments of one kind, name and unit are one metric, whatever their description.
export function metricKey({ kind, name, unit }: MetricDescriptor): string {
  return JSON.stringify([kind, name, unit])
}

export function createOtlpMeasurement(
  descriptor: MetricDescriptor,
  value: number,
  attributes: MetricAttributes,
  clock: SeriesClock,
  limits: OtlpLimits = DEFAULT_LIMITS,
): OtlpMeasurement {
  const encoded = encodeAttributes(attributes, limits).values
  const timeUnixNano = nowUnixNano()
  const seriesId = `${metricKey(descriptor)}|${seriesKey(encoded)}`

  return {
    descriptor,
    value,
    startTimeUnixNano: clock.advance(seriesId, timeUnixNano),
    timeUnixNano,
    attributes: encoded,
  }
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

function collapseSeries(
  measurements: readonly OtlpMeasurement[],
): MetricSeries[] {
  return groupBy(measurements, (m) => seriesKey(m.attributes)).map((group) => ({
    attributes: group[0]!.attributes,
    start: group.reduce(
      (min, m) => (m.startTimeUnixNano < min ? m.startTimeUnixNano : min),
      group[0]!.startTimeUnixNano,
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

function finiteAggregate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Metric aggregate is not finite')
  }
  return value
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
  const sum = values.some((value) => value < 0)
    ? undefined
    : finiteAggregate(values.reduce((total, value) => total + value, 0))

  return {
    count: String(values.length),
    // OTLP: a sum is only meaningful when every value is non-negative.
    ...(sum === undefined ? {} : { sum }),
    bucketCounts: counts.map(String),
    explicitBounds: bounds,
    // A reduce, not a spread: a large batch would exceed the call argument limit.
    min: values.reduce((min, value) => Math.min(min, value)),
    max: values.reduce((max, value) => Math.max(max, value)),
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
  const attributesOf = (s: MetricSeries) =>
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
        ...numberValue(finiteAggregate(s.total), s.allIntegers),
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
