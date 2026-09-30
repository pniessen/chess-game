import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useClaudeRecord } from './useClaudeRecord'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const REC = (games: number) => ({ games, whiteModelWins: games, blackModelWins: 0, draws: 0, whiteWins: games, blackWins: 0 })

// Vitest runs in mode 'test', where CLAUDE_GAMES is false: the hook is tested with the gate open.
vi.mock('../../claude/enabled', () => ({ CLAUDE_GAMES: true }))

describe('useClaudeRecord', () => {
  test('fetches nothing without a pairing', () => {
    const fetch = vi.fn()
    const { result } = renderHook(() => useClaudeRecord(null, 0, fetch))
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  test('loads the record when the pairing is set', async () => {
    const fetch = vi.fn().mockResolvedValue(json(REC(2)))
    const { result } = renderHook(() => useClaudeRecord({ white: 'sonnet', black: 'haiku' }, 0, fetch))
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toEqual(REC(2)))
    expect(fetch).toHaveBeenCalledWith('/api/game/record?white=sonnet&black=haiku')
  })

  test('null when the record cannot be read', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useClaudeRecord({ white: 'sonnet', black: 'haiku' }, 0, fetch))
    await waitFor(() => expect(result.current).toBeNull())
  })

  test('refetches when the refresh key moves (a game ended), keeping the old record meanwhile', async () => {
    let n = 1
    const fetch = vi.fn(async () => json(REC(n)))
    const pair = { white: 'sonnet', black: 'haiku' } as const
    const { result, rerender } = renderHook(({ key }) => useClaudeRecord(pair, key, fetch), {
      initialProps: { key: 0 },
    })
    await waitFor(() => expect(result.current).toEqual(REC(1)))
    n = 2
    rerender({ key: 1 })
    expect(result.current).toEqual(REC(1))
    await waitFor(() => expect(result.current).toEqual(REC(2)))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('a new pairing starts from loading and drops a stale answer for the old one', async () => {
    const resolvers: Array<(r: Response) => void> = []
    const fetch = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)))
    const { result, rerender } = renderHook(({ pair }) => useClaudeRecord(pair, 0, fetch), {
      initialProps: { pair: { white: 'sonnet', black: 'haiku' } as const as { white: 'sonnet' | 'opus'; black: 'haiku' } },
    })
    rerender({ pair: { white: 'opus', black: 'haiku' } })
    expect(fetch).toHaveBeenLastCalledWith('/api/game/record?white=opus&black=haiku')
    resolvers[0]!(json(REC(5))) // the old pairing's late answer
    resolvers[1]!(json(REC(1)))
    await waitFor(() => expect(result.current).toEqual(REC(1)))
  })

  test('the same pairing in a new object does not refetch', async () => {
    const fetch = vi.fn().mockResolvedValue(json(REC(1)))
    const { rerender } = renderHook(({ pair }) => useClaudeRecord(pair, 0, fetch), {
      initialProps: { pair: { white: 'sonnet', black: 'haiku' } as const },
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    rerender({ pair: { white: 'sonnet', black: 'haiku' } as const })
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
