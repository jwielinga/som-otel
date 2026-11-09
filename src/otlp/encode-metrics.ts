import { nowUnixNano } from '../utils/clock.js'
import type {
  LogAttributes,
  MetricAttributes,
  MetricDescriptor,
  OTelJsonKeyValue,
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
}: MetricDescriptor): string {
  return JSON.stringify([kind, name, unit, description])
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

function encodeMetric(
  descriptor: MetricDescriptor,
  measurements: readonly OtlpMeasurement[],
): OTelJsonMetric {
  const dataPoints = collapseSeries(measurements).map(
    (series): OTelJsonNumberDataPoint => ({
      attributes: series.attributes.length > 0 ? series.attributes : undefined,
      startTimeUnixNano: series.start.toString(),
      timeUnixNano: series.end.toString(),
      ...numberValue(series.total, series.allIntegers),
    }),
  )

  return {
    name: descriptor.name,
    description: descriptor.description,
    unit: descriptor.unit,
    sum: {
      dataPoints,
      aggregationTemporality: OTelAggregationTemporality.DELTA,
      isMonotonic: true,
    },
  }
}

// Collapses a batch of measurements into delta data points, one per metric and attribute set.
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
