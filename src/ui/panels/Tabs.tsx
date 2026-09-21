import type { ReactNode } from 'react'

export interface TabSpec {
  id: string
  label: string
  content: ReactNode
}

/** An ARIA tab group. Inactive panels stay mounted (hidden) so their state survives. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabSpec[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="tabs">
      <div className="tabs-header" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-testid={`tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`panel-${t.id}`}
            className={t.id === active ? 'active' : ''}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          className="tab-panel"
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  )
}
