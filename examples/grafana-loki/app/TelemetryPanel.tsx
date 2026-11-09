import { useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTime } from './format-time'
import { LogFeed } from './LogFeeds'
import { som } from './logger'
import type { TelemetryAction } from './telemetry-actions'
import type { SendState } from './types'

type Entry = {
  id: number
  label: string
  detail?: string
  state: SendState
  at: Date
}

type TelemetryPanelProps = {
  id: string
  title: string
  icon: LucideIcon
  actions: TelemetryAction[]
  feedTitle: string
  empty: string
}

export function TelemetryPanel({
  id: panelId,
  title,
  icon: Icon,
  actions,
  feedTitle,
  empty,
}: TelemetryPanelProps) {
  const [entries, setEntries] = useState<Entry[]>([])
  const nextId = useRef(0)

  const patch = (id: number, changes: Partial<Entry>) =>
    setEntries((items) =>
      items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    )

  const run = async (action: TelemetryAction) => {
    const id = ++nextId.current
    setEntries((items) =>
      [
        {
          id,
          label: action.label,
          state: 'sending' as const,
          at: new Date(),
        },
        ...items,
      ].slice(0, 8),
    )

    try {
      const detail = await action.run()
      // Instrument and span calls have no promise, so flush to learn whether the export worked.
      await som.flush()
      patch(id, { state: 'sent', detail })
    } catch (error) {
      patch(id, {
        state: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <section className="controls" aria-labelledby={`${panelId}-title`}>
      <h2 id={`${panelId}-title`}>{title}</h2>
      <div className="actions">
        {actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            onClick={() => void run(action)}
          >
            <Icon aria-hidden="true" className="icon-info" />
            {action.label}
          </Button>
        ))}
      </div>

      <LogFeed title={feedTitle} note="Som → Alloy" empty={empty}>
        {entries.map((entry) => (
          <li className="row" key={entry.id}>
            <span className="message" title={entry.detail}>
              {entry.label}
              {entry.detail ? `: ${entry.detail}` : ''}
            </span>
            <Badge
              variant={
                entry.state === 'sent'
                  ? 'success'
                  : entry.state === 'failed'
                    ? 'error'
                    : 'muted'
              }
            >
              {entry.state}
            </Badge>
            <time>{formatTime(entry.at)}</time>
          </li>
        ))}
      </LogFeed>
    </section>
  )
}
