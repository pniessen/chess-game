import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Game } from '../../game-core/game'
import { GameIO } from './GameIO'

/** Stubs `navigator.clipboard`, restoring whatever was there afterwards. */
function stubClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  return () => {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
}

afterEach(() => vi.restoreAllMocks())

describe('GameIO — Task 14 share button', () => {
  test('copies the share URL to the clipboard and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const restore = stubClipboard({ writeText })
    try {
      render(<GameIO game={new Game()} onImport={vi.fn()} />)
      fireEvent.click(screen.getByTestId('share-link'))
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const url = writeText.mock.calls[0]?.[0] as string
      expect(url).toContain('?fen=')
      await screen.findByTestId('share-status')
      expect(screen.getByTestId('share-status')).toHaveTextContent(/copied/i)
      expect(screen.queryByTestId('share-manual')).toBeNull()
    } finally {
      restore()
    }
  })

  test('degrades to a manual copy box when there is no Clipboard API', async () => {
    const restore = stubClipboard(undefined)
    try {
      render(<GameIO game={new Game()} onImport={vi.fn()} />)
      fireEvent.click(screen.getByTestId('share-link'))
      const box = await screen.findByTestId('share-manual')
      const input = box.querySelector('input') as HTMLInputElement
      expect(input.value).toContain('?fen=')
      expect(screen.queryByTestId('share-status')).toBeNull()
    } finally {
      restore()
    }
  })

  test('degrades to a manual copy box when the clipboard write is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const restore = stubClipboard({ writeText })
    try {
      render(<GameIO game={new Game()} onImport={vi.fn()} />)
      fireEvent.click(screen.getByTestId('share-link'))
      const box = await screen.findByTestId('share-manual')
      expect(box.querySelector('input')).not.toBeNull()
    } finally {
      restore()
    }
  })

  // Review round 1 (Task 14) polish: MatchController mutates ONE Game
  // object in place across moves (see game-core/game.ts) rather than
  // replacing it, so the share URL/status must key off `game.ply`
  // changing, not the `game` prop's identity — which a move alone never
  // changes.
  test('a move after Share invalidates the old confirmation and URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const restore = stubClipboard({ writeText })
    try {
      const game = new Game()
      const { rerender } = render(<GameIO game={game} onImport={vi.fn()} />)
      fireEvent.click(screen.getByTestId('share-link'))
      await screen.findByTestId('share-status')
      const staleUrl = writeText.mock.calls[0]?.[0] as string
      expect(new URL(staleUrl).searchParams.get('fen')).toBe(game.current().fen())

      // The SAME Game instance, mutated in place — exactly what the real
      // app hands GameIO on every move.
      const played = game.play({ from: 'e2', to: 'e4' })
      expect(played.ok).toBe(true)
      rerender(<GameIO game={game} onImport={vi.fn()} />)

      expect(screen.queryByTestId('share-status')).toBeNull()
      expect(screen.queryByTestId('share-manual')).toBeNull()

      // Sharing again offers the NEW position, not the stale one.
      fireEvent.click(screen.getByTestId('share-link'))
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
      const freshUrl = writeText.mock.calls[1]?.[0] as string
      expect(freshUrl).not.toBe(staleUrl)
      expect(new URL(freshUrl).searchParams.get('fen')).toBe(game.current().fen())
    } finally {
      restore()
    }
  })
})
