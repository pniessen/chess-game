import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Task 13: the app-wide keyboard shortcuts, through the whole App. A
 * scripted stand-in for EngineClient makes `engineAvailable` true, so the
 * Hint shortcut has something to disable/enable.
 */
vi.mock('../engine/client', () => ({
  createWorkerTransport: () => ({}),
  EngineClient: class {
    waitReady() {
      return Promise.resolve()
    }
    configure() {}
    newGame() {}
    setPosition() {}
    search() {
      return Promise.resolve({ best: '(none)', lines: [] })
    }
    stop() {}
    dispose() {}
    onDead() {
      return () => {}
    }
  },
}))

const { App } = await import('./App')

function clickSquare(container: HTMLElement, square: string) {
  fireEvent.click(container.querySelector(`[data-square="${square}"]`) as HTMLElement)
}

beforeEach(() => localStorage.clear())

describe('keyboard shortcuts', () => {
  test('Left/Right/Home/End step through moves via the real move-input path', () => {
    // `ply-count` is the total move COUNT (game.moves.length), unaffected
    // by browsing — stepping only moves the DISPLAYED ply, which the move
    // list's own 'current' class exposes (see MoveList.tsx).
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    clickSquare(container, 'e7')
    clickSquare(container, 'e5')
    expect(screen.getByTestId('ply-count')).toHaveTextContent('2')
    expect(screen.getByTestId('move-2')).toHaveClass('current')

    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(screen.getByTestId('move-1')).toHaveClass('current')
    expect(screen.getByTestId('move-2')).not.toHaveClass('current')
    // Still two moves played — browsing never truncates the game.
    expect(screen.getByTestId('ply-count')).toHaveTextContent('2')

    fireEvent.keyDown(document, { key: 'Home' })
    expect(screen.getByTestId('move-1')).not.toHaveClass('current')
    expect(screen.getByTestId('move-2')).not.toHaveClass('current')

    fireEvent.keyDown(document, { key: 'End' })
    expect(screen.getByTestId('move-2')).toHaveClass('current')

    fireEvent.keyDown(document, { key: 'ArrowRight' })
    // Already at the end: no further move to step to.
    expect(screen.getByTestId('move-2')).toHaveClass('current')
  })

  test('u undoes and r redoes', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    expect(screen.getByTestId('ply-count')).toHaveTextContent('1')

    fireEvent.keyDown(document, { key: 'u' })
    expect(screen.getByTestId('ply-count')).toHaveTextContent('0')
    fireEvent.keyDown(document, { key: 'r' })
    expect(screen.getByTestId('ply-count')).toHaveTextContent('1')
  })

  test('f flips the board', () => {
    const { container } = render(<App />)
    const isFlipped = () => container.querySelector('.board')?.className.includes('black')
    expect(isFlipped()).toBeFalsy()
    fireEvent.keyDown(document, { key: 'f' })
    expect(isFlipped()).toBeTruthy()
  })

  test('p opens puzzles, same as the button', () => {
    render(<App />)
    fireEvent.keyDown(document, { key: 'p' })
    expect(screen.getByTestId('puzzle-screen')).toBeInTheDocument()
  })

  test('? opens the shortcuts overlay and Escape closes it, returning focus', () => {
    render(<App />)
    const trigger = screen.getByTestId('shortcuts-toggle')
    trigger.focus()
    fireEvent.keyDown(document, { key: '?' })
    expect(screen.getByTestId('shortcuts-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('shortcuts-overlay')).toHaveFocus()

    fireEvent.keyDown(screen.getByTestId('shortcuts-overlay'), { key: 'Escape' })
    expect(screen.queryByTestId('shortcuts-overlay')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  test('shortcuts do not fire while typing in the PGN/FEN import box', () => {
    const { container } = render(<App />)
    const textarea = screen.getByTestId('import-text')
    fireEvent.change(textarea, { target: { value: 'f' } })
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'f' })
    expect(container.querySelector('.board')?.className.includes('black')).toBeFalsy()
  })

  test('shortcuts do not fire while the settings popover owns the keyboard', () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('settings-toggle'))
    expect(screen.getByTestId('settings')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'p' })
    expect(screen.queryByTestId('puzzle-screen')).not.toBeInTheDocument()
    // Settings itself still closes on its own Escape, unaffected.
    fireEvent.keyDown(screen.getByTestId('settings'), { key: 'Escape' })
    expect(screen.queryByTestId('settings')).not.toBeInTheDocument()
  })

  test("Escape cancels the promotion picker, which has no Escape handling of its own", () => {
    const { container } = render(<App />)
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 ... set up a simple promotion: push a white
    // pawn to the 7th and try to promote on e8 is slow to set up by hand;
    // instead drive a position one FEN import away from a legal promotion.
    fireEvent.change(screen.getByTestId('import-text'), {
      target: { value: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1' },
    })
    fireEvent.click(screen.getByTestId('import-submit'))
    clickSquare(container, 'e7')
    clickSquare(container, 'e8')
    expect(screen.getByRole('dialog', { name: 'Choose a promotion piece' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose a promotion piece' })).not.toBeInTheDocument()
    expect(screen.getByTestId('ply-count')).toHaveTextContent('0')
  })

  test('h does nothing when the hint button is disabled (idle game, no move to hint about)', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('hint')).toBeDisabled())
    fireEvent.keyDown(document, { key: 'h' })
    expect(screen.getByTestId('hint-text')).toBeEmptyDOMElement()
  })
})
