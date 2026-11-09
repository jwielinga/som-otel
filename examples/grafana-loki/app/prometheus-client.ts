import { SERVICE_NAME } from './logger'

export type PrometheusSample = {
  key: string
  name: string
  labels: string
  value: number
  timestamp: Date
}

type PrometheusResponse = {
  data: {
    result: {
      metric: Record<string, string>
      value: [number, string]
    }[]
  }
}

// Labels Prometheus adds itself; they say nothing about the measurement.
const HIDDEN_LABELS = new Set(['__name__', 'job', 'instance'])

// Bucket series would drown the list; _count and _sum say enough.
const QUERY = `{job="${SERVICE_NAME}", __name__=~"demo_.+", __name__!~".+_bucket"}`

function describeLabels(metric: Record<string, string>): string {
  return Object.entries(metric)
    .filter(([key]) => !HIDDEN_LABELS.has(key) && !key.startsWith('otel_scope'))
    .map(([key, value]) => `${key}="${value}"`)
    .join(', ')
}

export async function fetchPrometheusSamples(
  signal: AbortSignal,
): Promise<PrometheusSample[]> {
  const params = new URLSearchParams({ query: QUERY })
  const response = await fetch(`/prometheus/api/v1/query?${params}`, { signal })
  if (!response.ok) {
    throw new Error(`Prometheus returned HTTP ${response.status}`)
  }

  const body = (await response.json()) as PrometheusResponse
  return body.data.result
    .map(({ metric, value: [seconds, value] }) => {
      const labels = describeLabels(metric)
      return {
        key: `${metric.__name__}{${labels}}`,
        name: metric.__name__ ?? 'unknown',
        labels,
        value: Number(value),
        timestamp: new Date(seconds * 1000),
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
}
