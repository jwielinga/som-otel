import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type TabItem = {
  id: string
  label: string
  icon: LucideIcon
  content: ReactNode
}

// Every panel stays mounted, so feeds and polling survive a tab switch.
export function Tabs({ label, items }: { label: string; items: TabItem[] }) {
  const [selected, setSelected] = useState(items[0]?.id)
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({})

  const select = (id: string) => {
    setSelected(id)
    tabs.current[id]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = items.length - 1
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key]
    if (target === undefined) return

    event.preventDefault()
    select(items[target]!.id)
  }

  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label={label}>
        {items.map(({ id, label: tabLabel, icon: Icon }, index) => (
          <button
            key={id}
            ref={(element) => {
              tabs.current[id] = element
            }}
            id={`tab-${id}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={selected === id}
            aria-controls={`tabpanel-${id}`}
            tabIndex={selected === id ? 0 : -1}
            onClick={() => setSelected(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon aria-hidden="true" className="size-4" />
            {tabLabel}
          </button>
        ))}
      </div>
      {items.map(({ id, content }) => (
        <div
          key={id}
          id={`tabpanel-${id}`}
          role="tabpanel"
          className="tabpanel"
          aria-labelledby={`tab-${id}`}
          hidden={selected !== id}
        >
          {content}
        </div>
      ))}
    </div>
  )
}
