import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { HistoryPanel } from './HistoryPanel'
import type { HistoryEntry } from '../../storage/storage'

const entry: HistoryEntry = {
  id: 'a',
  date: '2026-09-21T10:00:00.000Z',
  result: '1-0',
  termination: 'normal',
  opening: 'B20 Sicilian Defense',
  pgn: '1. e4 c5 *',
  accuracy: null,
  white: 'Human',
  black: 'Stockfish (level 3)',
}

describe('HistoryPanel', () => {
  test('no notice when the history is ok, even if empty', () => {
    render(<HistoryPanel entries={[]} status="ok" onReplay={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByTestId('history-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('history-notice')).not.toBeInTheDocument()
  })

  test('no notice when the history is merely empty (no key yet)', () => {
    render(<HistoryPanel entries={[]} status="empty" onReplay={vi.fn()} onReset={vi.fn()} />)
    expect(screen.queryByTestId('history-notice')).not.toBeInTheDocument()
  })

  test('unreadable history shows the notice, without the newer-version line', () => {
    render(<HistoryPanel entries={[]} status="unreadable" onReplay={vi.fn()} onReset={vi.fn()} />)
    const notice = screen.getByTestId('history-notice')
    expect(notice).toHaveTextContent(
      "Your saved game history can't be read, so finished games aren't being saved.",
    )
    expect(notice).not.toHaveTextContent('newer version')
  })

  test('newer-version history shows the notice plus the newer-version line', () => {
    render(<HistoryPanel entries={[]} status="newer-version" onReplay={vi.fn()} onReset={vi.fn()} />)
    const notice = screen.getByTestId('history-notice')
    expect(notice).toHaveTextContent(
      "Your saved game history can't be read, so finished games aren't being saved.",
    )
    expect(notice).toHaveTextContent('It may have been written by a newer version of this app.')
  })

  test('reset is a two-step confirm: Reset -> Confirm/Cancel, and only Confirm calls onReset', () => {
    const onReset = vi.fn()
    render(<HistoryPanel entries={[]} status="unreadable" onReplay={vi.fn()} onReset={onReset} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset history' }))
    expect(screen.queryByRole('button', { name: 'Reset history' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm reset — this deletes saved games' })).toBeInTheDocument()
    expect(onReset).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onReset).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reset history' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset — this deletes saved games' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  test('history list still renders alongside the notice', () => {
    render(<HistoryPanel entries={[entry]} status="unreadable" onReplay={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByTestId('history-notice')).toBeInTheDocument()
    expect(screen.getByTestId('history-entry')).toBeInTheDocument()
  })
})
