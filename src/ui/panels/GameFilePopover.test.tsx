import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Game } from '../../game-core/game'
import { GameFilePopover } from './GameFilePopover'
import { SettingsPopover } from './SettingsPopover'
import { DEFAULT_SETTINGS } from '../../storage/storage'

/**
 * Task 4 (above the fold): the Game file popover.
 *
 * Each test names the change that turns it red:
 *  - the trigger tests turn red if it loses `aria-haspopup`/`aria-expanded`
 *    or stops toggling.
 *  - the keyboard tests turn red if the focus trap is dropped, if Escape
 *    stops closing it, if focus stops returning to the trigger, or if the
 *    `document`-level Escape fallback is removed.
 *  - the contents test turns red if GameIO is rendered back in the board
 *    column, or loses any of the ids the rest of the suite drives it by.
 *  - the exclusion test turns red if either popover stops dismissing
 *    itself on an outside pointerdown, which is the whole mechanism that
 *    keeps the two from being open together.
 */

/** The real click sequence: a bare `fireEvent.click` never fires pointerdown. */
function press(el: HTMLElement) {
  fireEvent.pointerDown(el)
  fireEvent.click(el)
}

function renderPopover(onImport = vi.fn()) {
  const onOpenChange = vi.fn()
  render(<GameFilePopover game={new Game()} onImport={onImport} onOpenChange={onOpenChange} />)
  return { trigger: screen.getByTestId('game-file-toggle'), onOpenChange, onImport }
}

describe('the trigger', () => {
  test('is a labelled dialog trigger that toggles the popover', () => {
    const { trigger, onOpenChange } = renderPopover()
    expect(trigger).toHaveTextContent('Game file')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('game-file')).toBeNull()

    press(trigger)
    expect(screen.getByTestId('game-file')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    press(trigger)
    expect(screen.queryByTestId('game-file')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  test('the popover is a dialog that does NOT claim to be modal', () => {
    const { trigger } = renderPopover()
    press(trigger)
    const pop = screen.getByTestId('game-file')
    expect(pop).toHaveAttribute('role', 'dialog')
    expect(pop).toHaveAttribute('aria-label', 'Game file')
    // The game behind stays live, so modality would be a lie — Task 12's
    // ruling, carried over verbatim.
    expect(pop).not.toHaveAttribute('aria-modal')
  })
})

describe('contents', () => {
  test('every GameIO control is reachable inside the popover', () => {
    const { trigger } = renderPopover()
    press(trigger)
    const pop = screen.getByTestId('game-file')
    for (const id of ['export-pgn', 'share-link', 'import-text', 'import-file', 'import-submit', 'import-error']) {
      expect(pop).toContainElement(screen.getByTestId(id))
    }
  })

  test('a successful import closes the popover and returns focus to the trigger', () => {
    const onImport = vi.fn()
    const { trigger } = renderPopover(onImport)
    press(trigger)
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: '1. e4 e5 *' } })
    fireEvent.click(screen.getByTestId('import-submit'))

    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('game-file')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  test('a failed import leaves the popover open with the error showing', () => {
    const onImport = vi.fn()
    const { trigger } = renderPopover(onImport)
    press(trigger)
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: 'not a game' } })
    fireEvent.click(screen.getByTestId('import-submit'))

    expect(onImport).not.toHaveBeenCalled()
    expect(screen.getByTestId('game-file')).toBeInTheDocument()
    expect(screen.getByTestId('import-error')).not.toBeEmptyDOMElement()
  })
})

describe('keyboard', () => {
  test('focus enters the popover itself, and Escape returns it to the trigger', () => {
    const { trigger } = renderPopover()
    press(trigger)
    const pop = screen.getByTestId('game-file')
    expect(pop).toHaveFocus()

    fireEvent.keyDown(pop, { key: 'Escape' })
    expect(screen.queryByTestId('game-file')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  test('Tab cycles inside the popover instead of walking the page behind it', () => {
    const { trigger } = renderPopover()
    press(trigger)
    const pop = screen.getByTestId('game-file')
    const first = screen.getByTestId('export-pgn')
    const last = screen.getByTestId('game-file-done')

    // Forward off the end wraps to the first control...
    last.focus()
    fireEvent.keyDown(pop, { key: 'Tab' })
    expect(first).toHaveFocus()

    // ...and backwards off the front wraps to the last.
    fireEvent.keyDown(pop, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  test('Done closes it and returns focus to the trigger', () => {
    const { trigger } = renderPopover()
    press(trigger)
    fireEvent.click(screen.getByTestId('game-file-done'))
    expect(screen.queryByTestId('game-file')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  /**
   * The GameEndCard hole. GameIO tears its own contents down as the game
   * moves — the `share-manual` box, and the focusable URL input inside it,
   * vanish the moment `game.ply` changes — and an engine reply does that
   * with no click anywhere, so focus can land on `<body>` while the
   * popover is still open. `pop.blur()` stands in for that here, the same
   * way App.shortcuts.test.tsx stands in for a board click on the game-end
   * card: jsdom's own events never move `document.activeElement`.
   *
   * Remove the `documentEscape` listener from usePopover and this is the
   * test that goes red — the React `onKeyDown` on the popover never sees a
   * keystroke delivered to `<body>`.
   */
  test('Escape still closes it when focus has drifted out to <body>', () => {
    const { trigger } = renderPopover()
    press(trigger)
    const pop = screen.getByTestId('game-file')
    pop.blur()
    expect(document.body).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('game-file')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  test('the document-level listener is torn down with the popover', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { trigger } = renderPopover()
    press(trigger)
    fireEvent.keyDown(screen.getByTestId('game-file'), { key: 'Escape' })
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
    remove.mockRestore()
  })
})

describe('two popovers are never open at once', () => {
  /**
   * There is no arbiter for this and deliberately none was added: each
   * popover already closes itself on a pointerdown outside it, and the
   * other trigger IS outside it, so the pointerdown that opens one closes
   * the other before its own click lands. Enforcing it from App would have
   * meant making SettingsPopover controlled — a change to a component this
   * task was asked to leave alone — to reproduce a guarantee that holds.
   */
  function renderBoth() {
    render(
      <>
        <GameFilePopover game={new Game()} onImport={vi.fn()} />
        <SettingsPopover settings={DEFAULT_SETTINGS} onChange={vi.fn()} />
      </>,
    )
    return {
      gameFile: screen.getByTestId('game-file-toggle'),
      settings: screen.getByTestId('settings-toggle'),
    }
  }

  test('opening Settings closes Game file', () => {
    const { gameFile, settings } = renderBoth()
    press(gameFile)
    expect(screen.getByTestId('game-file')).toBeInTheDocument()

    press(settings)
    expect(screen.queryByTestId('game-file')).toBeNull()
    expect(screen.getByTestId('settings')).toBeInTheDocument()
  })

  test('opening Game file closes Settings', () => {
    const { gameFile, settings } = renderBoth()
    press(settings)
    expect(screen.getByTestId('settings')).toBeInTheDocument()

    press(gameFile)
    expect(screen.queryByTestId('settings')).toBeNull()
    expect(screen.getByTestId('game-file')).toBeInTheDocument()
  })
})
