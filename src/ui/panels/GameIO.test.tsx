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
})
