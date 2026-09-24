import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ShortcutsOverlay } from './ShortcutsOverlay'

/**
 * Mirrors how App.tsx actually uses it: the overlay is conditionally
 * mounted only once `open` flips true, so its opener-capture effect (which
 * runs once, on mount) sees whatever had focus right before that —
 * matching the real `?`-press / button-click sequencing.
 */
function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div>
      <button data-testid="opener">Opener</button>
      {open ? <ShortcutsOverlay onClose={onClose} /> : null}
    </div>
  )
}

describe('ShortcutsOverlay', () => {
  test('is a labelled, modal dialog that takes focus on mount', () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    const overlay = screen.getByTestId('shortcuts-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    // Unlike settings/the game-end card, a real backdrop covers the board
    // here, so nothing behind it is reachable — aria-modal is accurate.
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(overlay).toHaveAccessibleName('Keyboard shortcuts')
    expect(overlay).toHaveFocus()
  })

  test('lists every shortcut from the brief', () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    const text = screen.getByTestId('shortcuts-overlay').textContent ?? ''
    for (const fragment of ['Step back', 'Flip the board', 'Undo', 'Redo', 'hint', 'puzzles', 'Close a dialog']) {
      expect(text).toContain(fragment)
    }
  })

  test('Escape closes it', () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay onClose={onClose} />)
    fireEvent.keyDown(screen.getByTestId('shortcuts-overlay'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('the Close button closes it', () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay onClose={onClose} />)
    fireEvent.click(screen.getByTestId('shortcuts-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('closing restores focus to whatever opened it', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Harness open={false} onClose={onClose} />)
    screen.getByTestId('opener').focus()
    expect(screen.getByTestId('opener')).toHaveFocus()

    // Mounts the overlay (the button click / '?' press), capturing the
    // opener that had focus a moment ago.
    rerender(<Harness open onClose={onClose} />)
    fireEvent.keyDown(screen.getByTestId('shortcuts-overlay'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('opener')).toHaveFocus()
  })

  test('Tab wraps round inside the overlay (only the Close button is focusable)', () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    const overlay = screen.getByTestId('shortcuts-overlay')
    fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('shortcuts-close')).toHaveFocus()
    fireEvent.keyDown(overlay, { key: 'Tab' })
    expect(screen.getByTestId('shortcuts-close')).toHaveFocus()
  })

  // Review round 1 (Task 13/14) polish: a click on the backdrop (a plain,
  // non-focusable element) used to do nothing at all — the overlay stayed
  // open with focus blurred to <body>, escapable.
  test('a backdrop click dismisses it and restores focus, the same as Escape/Close', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Harness open={false} onClose={onClose} />)
    screen.getByTestId('opener').focus()
    rerender(<Harness open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('shortcuts-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('opener')).toHaveFocus()
  })

  test('a click INSIDE the dialog does not dismiss it', () => {
    const onClose = vi.fn()
    render(<ShortcutsOverlay onClose={onClose} />)
    fireEvent.click(screen.getByText('Keyboard shortcuts'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('shortcuts-overlay')).toBeInTheDocument()
  })

  // Review round 1 (Task 13/14) polish: previously, once focus had left the
  // dialog (e.g. via the backdrop-blur bug above), Escape reached only the
  // app-wide shortcuts listener, which closed `helpOpen` directly without
  // restoring focus — this document-level fallback closes it properly
  // regardless of where focus is.
  test('Escape closes it and restores focus even when focus is OUTSIDE the dialog', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Harness open={false} onClose={onClose} />)
    const opener = screen.getByTestId('opener')
    opener.focus()
    rerender(<Harness open onClose={onClose} />)

    // Simulate focus having ended up outside the dialog (the backdrop-blur
    // scenario): move focus to the opener, then press Escape on `document`
    // rather than on the (now unfocused) dialog element.
    opener.focus()
    expect(screen.getByTestId('shortcuts-overlay')).not.toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
  })
})
