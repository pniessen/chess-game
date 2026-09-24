import type { Game } from '../../game-core/game'
import type { PgnHeaders } from '../../game-core/io'
import { GameIO } from './GameIO'
import { usePopover } from './usePopover'

/**
 * Task 4 (above the fold): Export PGN, Share position and Import behind a
 * header trigger.
 *
 * They are the three lowest-frequency controls on the page and they cost
 * 287px of vertical space — most of it an 88px textarea that sat open,
 * empty, for the whole of every game. Moving them here is what empties
 * `.board-column` down to the board itself.
 *
 * The shell (focus trap, Escape, outside click, `onOpenChange`) is
 * `usePopover`, shared with `SettingsPopover` — see that file's Task 12
 * notes for why `aria-modal` is deliberately NOT set: the game behind
 * stays live and usable, so claiming modality would be a lie to assistive
 * tech, and the focus trap alone keeps the keyboard inside.
 *
 * Unlike settings, this one passes `documentEscape`. `GameIO` re-renders
 * its own contents as the game changes — the `share-manual` fallback (and
 * the readonly URL input inside it, which is focusable and which you focus
 * to copy by hand) is torn down by the `[game, game.ply]` effect the
 * instant the position moves under it. An engine reply or a flagging clock
 * does that with no click anywhere, so the focused input vanishes while
 * the popover is still open and focus lands on `<body>` — the exact hole
 * `GameEndCard` and `ShortcutsOverlay` were both caught by. From `<body>`
 * a React `onKeyDown` on the popover never sees the keystroke, so Escape
 * would be dead and, because this popover reports itself through
 * `overlayOpen`, every other shortcut would be dead with it. The
 * `document`-level listener in `usePopover` is the fix, added only while
 * open.
 *
 * A successful import closes the popover and returns focus to the trigger:
 * you asked for a different game, and what you want to look at next is the
 * board, not the form you loaded it from.
 */
export function GameFilePopover({
  game,
  headers,
  onImport,
  onOpenChange,
}: {
  game: Game
  headers?: PgnHeaders
  /** Called only once a pasted PGN/FEN has parsed successfully. */
  onImport: (game: Game) => void
  /** Task 13: lets the keyboard-shortcuts hook know an overlay owns the keyboard. */
  onOpenChange?: (open: boolean) => void
}) {
  const { open, toggle, close, triggerRef, popRef, handleKeyDown } = usePopover({
    onOpenChange,
    documentEscape: true,
  })

  return (
    <div className="game-file-anchor">
      <button
        type="button"
        className="game-file-trigger"
        data-testid="game-file-toggle"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="game-file-popover"
        onClick={toggle}
      >
        <span className="game-file-icon" aria-hidden="true" />
        Game file
      </button>

      {open ? (
        <div
          id="game-file-popover"
          className="game-file-popover"
          data-testid="game-file"
          role="dialog"
          aria-label="Game file"
          tabIndex={-1}
          ref={popRef}
          onKeyDown={handleKeyDown}
        >
          <GameIO
            game={game}
            headers={headers}
            onImport={(next) => {
              close(true)
              onImport(next)
            }}
          />
          <div className="game-file-actions">
            <button type="button" data-testid="game-file-done" onClick={() => close(true)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
