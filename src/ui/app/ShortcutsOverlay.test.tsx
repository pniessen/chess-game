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
  test('is a labelled dialog that takes focus on mount', () => {
    render(<ShortcutsOverlay onClose={vi.fn()} />)
    const overlay = screen.getByTestId('shortcuts-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
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
})
