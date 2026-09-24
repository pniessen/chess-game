import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useShortcuts } from './useShortcuts'

/**
 * A minimal harness: renders whatever focusable targets a test needs (an
 * input, a fake tab button, a fake dialog) alongside the hook's own state,
 * and exposes every callback as a call counter so a test can assert exactly
 * what fired.
 */
function Harness(props: Partial<Parameters<typeof useShortcuts>[0]> = {}) {
  const calls = {
    onJump: vi.fn(),
    onFlip: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onHint: vi.fn(),
    onOpenPuzzles: vi.fn(),
    onCancelPromotion: vi.fn(),
  }
  const shortcuts = useShortcuts({
    active: true,
    overlayOpen: false,
    promotionOpen: false,
    hintDisabled: false,
    currentPly: 2,
    totalPlies: 4,
    ...calls,
    ...props,
  })
  ;(window as unknown as { __calls: typeof calls; __shortcuts: typeof shortcuts }).__calls = calls
  ;(window as unknown as { __calls: typeof calls; __shortcuts: typeof shortcuts }).__shortcuts = shortcuts
  return (
    <div>
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
      <button data-testid="plain-button">Plain</button>
      <button data-testid="tab-button" role="tab">
        Tab
      </button>
      {shortcuts.helpOpen ? <div data-testid="help-open" /> : null}
    </div>
  )
}

const calls = () => (window as unknown as { __calls: Record<string, ReturnType<typeof vi.fn>> }).__calls

describe('useShortcuts', () => {
  test('ArrowLeft/ArrowRight step through moves via onJump, clamped to [0, total]', () => {
    render(<Harness currentPly={2} totalPlies={4} />)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(calls().onJump).toHaveBeenCalledWith(1)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(calls().onJump).toHaveBeenCalledWith(3)
  })

  test('Home/End jump to the start/end', () => {
    render(<Harness currentPly={2} totalPlies={4} />)
    fireEvent.keyDown(document, { key: 'Home' })
    expect(calls().onJump).toHaveBeenCalledWith(0)
    fireEvent.keyDown(document, { key: 'End' })
    expect(calls().onJump).toHaveBeenCalledWith(4)
  })

  test('f/u/r/h/p call their handlers', () => {
    render(<Harness />)
    fireEvent.keyDown(document, { key: 'f' })
    expect(calls().onFlip).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'u' })
    expect(calls().onUndo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'r' })
    expect(calls().onRedo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'h' })
    expect(calls().onHint).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'p' })
    expect(calls().onOpenPuzzles).toHaveBeenCalledTimes(1)
  })

  test('h does nothing while the hint is disabled', () => {
    render(<Harness hintDisabled />)
    fireEvent.keyDown(document, { key: 'h' })
    expect(calls().onHint).not.toHaveBeenCalled()
  })

  test('? opens the shortcuts overlay', () => {
    render(<Harness />)
    expect(screen.queryByTestId('help-open')).toBeNull()
    fireEvent.keyDown(document, { key: '?' })
    expect(screen.getByTestId('help-open')).toBeInTheDocument()
  })

  test('never fires while typing in an input, textarea, or select', () => {
    render(<Harness />)
    screen.getByTestId('text-input').focus()
    fireEvent.keyDown(screen.getByTestId('text-input'), { key: 'f' })
    expect(calls().onFlip).not.toHaveBeenCalled()

    screen.getByTestId('text-area').focus()
    fireEvent.keyDown(screen.getByTestId('text-area'), { key: 'u' })
    expect(calls().onUndo).not.toHaveBeenCalled()
  })

  test('a held modifier (Ctrl/Cmd/Alt) leaves browser/OS shortcuts alone', () => {
    render(<Harness />)
    fireEvent.keyDown(document, { key: 'r', metaKey: true })
    expect(calls().onRedo).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(calls().onFlip).not.toHaveBeenCalled()
  })

  test('Left/Right/Home/End are left to the tab group when a tab has focus, but other keys still work', () => {
    render(<Harness />)
    const tab = screen.getByTestId('tab-button')
    fireEvent.keyDown(tab, { key: 'ArrowLeft' })
    expect(calls().onJump).not.toHaveBeenCalled()
    fireEvent.keyDown(tab, { key: 'f' })
    expect(calls().onFlip).toHaveBeenCalledTimes(1)
  })

  test('nothing fires while an external overlay owns the keyboard, except Escape for the promotion picker', () => {
    render(<Harness overlayOpen promotionOpen />)
    fireEvent.keyDown(document, { key: 'f' })
    expect(calls().onFlip).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(calls().onJump).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(calls().onCancelPromotion).toHaveBeenCalledTimes(1)
  })

  test('nothing fires while the puzzle screen is active (active: false)', () => {
    render(<Harness active={false} />)
    fireEvent.keyDown(document, { key: 'f' })
    expect(calls().onFlip).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: '?' })
    expect(screen.queryByTestId('help-open')).toBeNull()
  })
})
