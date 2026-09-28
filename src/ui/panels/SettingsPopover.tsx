import type { Appearance, Settings } from '../../storage/storage'
import { BOARD_THEMES, boardTheme } from '../themes'
import { PIECE_SETS, pieceImageSrc } from '../pieceSets'
import { usePopover } from './usePopover'

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
  // Task 4: the trap, the focus dance and the outside-click dismissal now
  // live in `usePopover`, lifted out of this file verbatim so the Game file
  // popover could reuse them.
  //
  // `documentEscape` stays OFF here. Every control in this popover — every
  // radio, the sound checkbox, the volume slider, the eval switch, Done —
  // is mounted for as long as the popover is, whatever the game behind it
  // does: nothing here is conditionally rendered, so this component never
  // tears a focused element out from under the user by itself.
  //
  // Fix round 2 precision: that is not the same claim as "focus can never
  // fall out of this popover" — it can, from OUTSIDE it, and the earlier
  // version of this comment overstated the guarantee. `GameEndCard`
  // programmatically calls `card?.focus()` on mount (its own file, plain
  // `useEffect`), unconditionally, whenever a game ends — including while
  // this popover is open and holds focus. That `focus()` fires a
  // `focusout` with a NON-NULL `relatedTarget` (the card, a real element,
  // not `<body>`), so `usePopover`'s own guard — which only reacts to a
  // `relatedTarget === null` — correctly declines to intervene, by
  // design, and the popover's React focus trap goes inert while the
  // popover stays visually open. Verified live: two-player Bullet 1+0,
  // open this popover, focus something inside it, let the clock run out;
  // focus lands on the game-end card, not `<body>`, exactly as above.
  //
  // The conclusion — `documentEscape: false` is safe here — still holds,
  // but not for the reason this comment used to give. What actually
  // covers this hole is `GameEndCard`'s own focus restore (back to
  // whatever had focus when the game ended, once the card itself closes)
  // plus the two-layer Escape this produces (once to close/dismiss the
  // card, again to close the popover) — not the absence of conditionally
  // rendered content. The real risk this component still has none of is
  // narrower than advertised: something INSIDE this popover unmounting
  // while it holds focus. Add conditional content — a "saved"
  // confirmation, a reset-confirm step, anything that can appear and
  // vanish from WITHIN this popover — and pass `documentEscape: true`
  // when you do; `GameFilePopover` has the long version of why.
  const { open, toggle, close, triggerRef, popRef, handleKeyDown } = usePopover({ onOpenChange })

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
        onClick={toggle}
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
