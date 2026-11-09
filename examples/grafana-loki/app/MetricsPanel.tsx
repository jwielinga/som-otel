import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatTime } from './format-time'
import { metricActions } from './telemetry-actions'
import { TelemetryPanel } from './TelemetryPanel'
import {
  fetchPrometheusSamples,
  type PrometheusSample,
} from './prometheus-client'
import { usePolled } from './use-polled'

const NO_SAMPLES: PrometheusSample[] = []

// The metrics buttons, plus what Prometheus has stored from them.
export function MetricsPanel() {
  const { data, error, updatedAt } = usePolled(
    fetchPrometheusSamples,
    NO_SAMPLES,
    2000,
  )

  const note = error
    ? 'unreachable'
    : updatedAt
      ? `live · ${formatTime(updatedAt)}`
      : 'connecting'

  return (
    <TelemetryPanel
      id="metrics"
      title="Make metrics"
      icon={Activity}
      actions={metricActions}
      feedTitle="Sent metrics"
      empty="Nothing sent yet."
      stored={{
        title: 'Stored in Prometheus',
        note,
        noteState: error ? 'failed' : 'sent',
        empty: error
          ? `Cannot query Prometheus: ${error}`
          : 'No demo metrics in the last 5 minutes.',
        rows: data.map((sample) => (
          <li className="row" key={sample.key}>
            <span className="message" title={sample.key}>
              {sample.name}
              {sample.labels ? ` {${sample.labels}}` : ''}
            </span>
            <Badge variant="muted">
              {sample.value.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </Badge>
            <time>{formatTime(sample.timestamp)}</time>
          </li>
        )),
      }}
    />
  )
}
