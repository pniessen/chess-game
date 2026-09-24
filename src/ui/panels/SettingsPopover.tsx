import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Appearance, Settings } from '../../storage/storage'
import { BOARD_THEMES, boardTheme } from '../themes'
import { PIECE_SETS, pieceImageSrc } from '../pieceSets'

/**
 * Everything inside the popover that the Tab key can reach. A radio group
 * is ONE tab stop (the checked button, or the first when none is checked),
 * which is what `tabbables` below reproduces — querying the DOM naively
 * would make the trap hand focus to an unchecked radio and let an arrow
 * key silently change the setting.
 */
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])'

function tabbables(root: HTMLElement): HTMLElement[] {
  const seen = new Set<string>()
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return true
    if (el.checked) return true
    const group = [...root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${el.name}"]`)]
    if (group.some((r) => r.checked) || seen.has(el.name)) return false
    seen.add(el.name)
    return true
  })
}

/** The keys that change a range input's value (so a preview tone is warranted). */
const SLIDER_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
])

/** The two pieces every preview tile shows: one per colour, on both square shades. */
const PREVIEW_PIECES = ['wN', 'bP'] as const

const APPEARANCE_OPTIONS: ReadonlyArray<{ value: Appearance; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/**
 * Task 12: the settings popover.
 *
 * Board theme and piece set are picked from real previews — each tile is a
 * miniature of the actual board, drawn with the theme's own square colours
 * and the set's own SVGs through `pieceImageSrc` (so they keep resolving
 * under the GitHub Pages base path) — rather than from a `<select>` whose
 * option text tells you nothing about what you are choosing.
 *
 * Under them: light/dark/system, the sound switch with a volume slider,
 * and the evaluation-bar switch. Level and time control stay on the New
 * game panel, where they belong: they are choices for the NEXT game, made
 * next to the button that starts it, not display preferences.
 *
 * Keyboard: the labelled trigger opens it, focus moves to the popover, Tab
 * cycles inside it, Escape closes it and focus returns to the trigger.
 * `aria-modal` is deliberately NOT set (the correction made in Task 6): the
 * game behind stays live and usable — clicking the board plays a move and
 * closes the popover — so claiming modality would be a lie to assistive
 * tech. The focus trap alone keeps the keyboard inside.
 */
export function SettingsPopover({
  settings,
  onChange,
  onPreviewVolume,
  onOpenChange,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** Plays one move sound, so the volume slider is audible while you set it. */
  onPreviewVolume?: () => void
  /** Task 13: lets the keyboard-shortcuts hook know an overlay owns the keyboard. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
    },
    [setOpen],
  )

  // Focus the popover itself (not its first control) so a screen reader
  // announces "Settings" before reading the board previews.
  useEffect(() => {
    if (open) popRef.current?.focus({ preventScroll: true })
  }, [open])

  // A click anywhere else dismisses it, WITHOUT swallowing that click: the
  // board underneath is still a live game, and a move there should land.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      // Restore focus to the trigger only when it was actually inside the
      // popover (Task 12 review fix, round 1, finding 2): otherwise focus
      // was already somewhere else on the page (e.g. the board), and
      // yanking it to the trigger on every outside click would be a
      // surprise, not a courtesy.
      close(popRef.current?.contains(document.activeElement) ?? false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key !== 'Tab') return
    const pop = popRef.current
    if (!pop) return
    const nodes = tabbables(pop)
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === pop)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const volumePercent = Math.round(settings.volume * 100)

  return (
    <div className="settings-anchor">
      <button
        type="button"
        className="settings-trigger"
        data-testid="settings-toggle"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="settings-popover"
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span className="settings-gear" aria-hidden="true" />
        Settings
      </button>

      {open ? (
        <div
          id="settings-popover"
          className="settings-popover"
          data-testid="settings"
          role="dialog"
          aria-label="Settings"
          tabIndex={-1}
          ref={popRef}
          onKeyDown={handleKeyDown}
        >
          <fieldset className="settings-group">
            <legend>Board</legend>
            <div className="preview-grid">
              {BOARD_THEMES.map((t) => (
                <label
                  key={t.id}
                  className="preview-option"
                  data-selected={settings.themeId === t.id ? 'true' : undefined}
                >
                  <input
                    type="radio"
                    name="board-theme"
                    value={t.id}
                    data-testid={`board-theme-${t.id}`}
                    checked={settings.themeId === t.id}
                    onChange={() => onChange({ themeId: t.id })}
                  />
                  <span className="mini-board" aria-hidden="true">
                    <span className="mini-square" style={{ background: t.light }} />
                    <span className="mini-square" style={{ background: t.dark }}>
                      <img src={pieceImageSrc(settings.pieceSetId, 'wN')} alt="" />
                    </span>
                    <span className="mini-square" style={{ background: t.dark }} />
                    <span className="mini-square" style={{ background: t.light }}>
                      <img src={pieceImageSrc(settings.pieceSetId, 'bP')} alt="" />
                    </span>
                  </span>
                  <span className="preview-label">{t.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-group">
            <legend>Pieces</legend>
            <div className="preview-grid preview-grid-wide">
              {PIECE_SETS.map((p) => (
                <label
                  key={p.id}
                  className="preview-option"
                  data-selected={settings.pieceSetId === p.id ? 'true' : undefined}
                >
                  <input
                    type="radio"
                    name="piece-set"
                    value={p.id}
                    data-testid={`piece-set-${p.id}`}
                    checked={settings.pieceSetId === p.id}
                    onChange={() => onChange({ pieceSetId: p.id })}
                  />
                  <span className="mini-board mini-board-row" aria-hidden="true">
                    {PREVIEW_PIECES.map((code, i) => (
                      <span
                        key={code}
                        className="mini-square"
                        style={{
                          background: i === 0 ? boardTheme(settings.themeId).dark : boardTheme(settings.themeId).light,
                        }}
                      >
                        <img data-testid={`piece-preview-${p.id}-${code}`} src={pieceImageSrc(p.id, code)} alt="" />
                      </span>
                    ))}
                  </span>
                  <span className="preview-label">{p.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-group">
            <legend>Appearance</legend>
            <div className="chip-row">
              {APPEARANCE_OPTIONS.map((a) => (
                <label
                  key={a.value}
                  className="chip-option"
                  data-selected={settings.appearance === a.value ? 'true' : undefined}
                >
                  <input
                    type="radio"
                    name="appearance"
                    value={a.value}
                    data-testid={`appearance-${a.value}`}
                    checked={settings.appearance === a.value}
                    onChange={() => onChange({ appearance: a.value })}
                  />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-group">
            <legend>Sound</legend>
            <label className="settings-row">
              <input
                type="checkbox"
                data-testid="sound-toggle"
                checked={settings.soundEnabled}
                onChange={(e) => onChange({ soundEnabled: e.target.checked })}
              />
              Sound
            </label>
            <label className="settings-row settings-slider">
              <span>Volume</span>
              <input
                type="range"
                data-testid="volume"
                aria-label="Volume"
                min={0}
                max={100}
                step={5}
                value={volumePercent}
                onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
                // A preview once the drag or the key press ENDS, not on
                // every intermediate value: a machine-gun of move sounds
                // while dragging would be worse than no feedback at all.
                onPointerUp={onPreviewVolume}
                onKeyUp={(e) => {
                  // Only the keys that actually MOVED the slider — Escape
                  // and Tab leave it, and should leave in silence.
                  if (SLIDER_KEYS.has(e.key)) onPreviewVolume?.()
                }}
              />
              <output data-testid="volume-value">{volumePercent}%</output>
            </label>
          </fieldset>

          <fieldset className="settings-group">
            <legend>Board extras</legend>
            <label className="settings-row">
              <input
                type="checkbox"
                data-testid="eval-toggle"
                checked={settings.showEval}
                onChange={(e) => onChange({ showEval: e.target.checked })}
              />
              Evaluation bar
            </label>
          </fieldset>

          <div className="settings-actions">
            <button type="button" data-testid="settings-done" onClick={() => close(true)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
