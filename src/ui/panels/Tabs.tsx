import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabSpec {
  id: string
  label: string
  content: ReactNode
  disabled?: boolean
}

/**
 * An ARIA tab group following the WAI-ARIA "Tabs with automatic activation"
 * pattern: roving tabindex (selected tab is the only one in the Tab order),
 * ArrowLeft/ArrowRight move focus and selection together (wrapping at the
 * ends and skipping disabled tabs), Home/End jump to the first/last tab.
 * Inactive panels stay mounted (hidden) so their state survives.
 */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabSpec[]
  active: string
  onChange: (id: string) => void
}) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())

  function activate(id: string) {
    onChange(id)
    buttonRefs.current.get(id)?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const enabled = tabs.filter((t) => !t.disabled)
    const index = enabled.findIndex((t) => t.id === id)
    if (index === -1 || enabled.length === 0) return

    let target: TabSpec | undefined
    switch (event.key) {
      case 'ArrowRight':
        target = enabled[(index + 1) % enabled.length]
        break
      case 'ArrowLeft':
        target = enabled[(index - 1 + enabled.length) % enabled.length]
        break
      case 'Home':
        target = enabled[0]
        break
      case 'End':
        target = enabled[enabled.length - 1]
        break
      default:
        return
    }
    event.preventDefault()
    if (target) activate(target.id)
  }

  return (
    <div className="tabs">
      <div className="tabs-header" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              if (el) buttonRefs.current.set(t.id, el)
              else buttonRefs.current.delete(t.id)
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-testid={`tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            disabled={t.disabled}
            className={t.id === active ? 'active' : ''}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => handleKeyDown(e, t.id)}
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
