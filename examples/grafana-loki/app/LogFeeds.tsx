import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatTime, formatTimestampNs } from './format-time'
import type { LokiEntry } from './loki-client'
import type { SentLog, Severity } from './types'
import { severities } from './types'

type LogFeedsProps = {
  sent: SentLog[]
  lokiEntries: LokiEntry[]
  lokiError?: string
  lokiUpdatedAt?: Date
}

export function LogFeeds({
  sent,
  lokiEntries,
  lokiError,
  lokiUpdatedAt,
}: LogFeedsProps) {
  const lokiNote = lokiError
    ? 'unreachable'
    : lokiUpdatedAt
      ? `live · ${formatTime(lokiUpdatedAt)}`
      : 'connecting'

  return (
    <section className="feeds">
      <LogFeed title="Sent from this browser" note="Som → Alloy">
        {sent.map((item) => (
          <li className="row" key={item.id}>
            <SeverityLabel severity={item.severity} />
            <span className="message">{item.body}</span>
            <Badge
              variant={
                item.state === 'sent'
                  ? 'success'
                  : item.state === 'failed'
                    ? 'error'
                    : 'muted'
              }
            >
              {item.state}
            </Badge>
            <time>{formatTime(item.at)}</time>
          </li>
        ))}
      </LogFeed>

      <LogFeed
        title="Stored in Loki"
        note={lokiNote}
        noteState={lokiError ? 'failed' : 'sent'}
        empty={
          lokiError
            ? `Cannot query Loki: ${lokiError}`
            : 'No logs from som-demo in the last 15 minutes.'
        }
      >
        {lokiEntries.slice(0, 12).map((entry) => (
          <LokiRow key={entry.key} entry={entry} />
        ))}
      </LogFeed>
    </section>
  )
}

export function LogFeed({
  title,
  note,
  noteState,
  empty = 'Nothing sent yet.',
  children,
}: {
  title: string
  note: string
  noteState?: 'sent' | 'failed'
  empty?: string
  children: ReactNode[]
}) {
  return (
    <Card className="feed">
      <CardHeader className="feed-head">
        <CardTitle>{title}</CardTitle>
        <Badge variant={noteState === 'failed' ? 'error' : 'muted'}>
          {note}
        </Badge>
      </CardHeader>
      <CardContent className="feed-content">
        {children.length > 0 ? (
          <ol>{children}</ol>
        ) : (
          <p className="empty">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

function LokiRow({ entry }: { entry: LokiEntry }) {
  const severity: Severity =
    severities.find((level) => level === entry.severity) ?? 'info'

  return (
    <li className="row row--loki">
      <SeverityLabel severity={severity} text={entry.severity} />
      <span className="message" title={entry.line}>
        {entry.line}
      </span>
      <time>{formatTimestampNs(entry.timestampNs)}</time>
    </li>
  )
}

function SeverityLabel({
  severity,
  text = severity.toUpperCase(),
}: {
  severity: Severity
  text?: string
}) {
  const variant = {
    debug: 'secondary',
    info: 'info',
    warn: 'warning',
    error: 'error',
    fatal: 'fatal',
  } as const

  return <Badge variant={variant[severity]}>{text}</Badge>
}
