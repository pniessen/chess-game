import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { usePuzzleSession } from './usePuzzleSession'
import { specOfRated } from '../../puzzles/spec'
import type { PuzzleSpec } from '../../puzzles/types'
import { BACK_RANK, DEFENCE } from '../../../tests/fixtures/puzzles'

const DEF = specOfRated(DEFENCE)
const BACK = specOfRated(BACK_RANK)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

function mount(spec: PuzzleSpec | null = DEF, key: string | null = 'k1') {
  return renderHook(({ s, k }) => usePuzzleSession(s, k), {
    initialProps: { s: spec as PuzzleSpec | null, k: key as string | null },
  })
}

describe('usePuzzleSession', () => {
  // Breaks if the setup or the opponent's reply is not played automatically after its delay.
  test('plays the setup after 600 ms, waits for the solver, replies after 400 ms, solves', () => {
    const { result } = mount()
    expect(result.current.session?.phase).toBe('setup')
    advance(599)
    expect(result.current.session?.phase).toBe('setup')
    advance(1)
    expect(result.current.session?.phase).toBe('solver')
    act(() => result.current.submit({ from: 'f8', to: 'd8' }))
    expect(result.current.session?.phase).toBe('reply')
    advance(400)
    expect(result.current.session?.played).toEqual(['d3d6', 'f8d8', 'd6d8'])
    act(() => result.current.submit({ from: 'f6', to: 'd8' }))
    expect(result.current.session).toMatchObject({ phase: 'solved', outcome: 'win' })
  })

  // Breaks if a hint is free on a rated puzzle, or its stage survives a move.
  test('hint: two stages then no more; it decides a loss; a move resets the stage', () => {
    const { result } = mount()
    advance(600)
    act(() => result.current.hint())
    expect(result.current.hintStage).toBe(1)
    expect(result.current.session?.outcome).toBe('loss')
    act(() => result.current.hint())
    act(() => result.current.hint())
    expect(result.current.hintStage).toBe(2)
    act(() => result.current.submit({ from: 'f8', to: 'd8' }))
    expect(result.current.hintStage).toBe(0)
  })

  test('an illegal move changes nothing', () => {
    const { result } = mount()
    advance(600)
    const before = result.current.session
    act(() => result.current.submit({ from: 'a6', to: 'a4' }))
    expect(result.current.session).toBe(before)
  })

  test('show solution plays the whole line back, one move every 700 ms', () => {
    const { result } = mount()
    advance(600)
    act(() => result.current.showSolution())
    expect(result.current.session).toMatchObject({ phase: 'showing', played: ['d3d6'] })
    // One act() per step: the next timer is only scheduled once React has committed the previous one.
    advance(700)
    expect(result.current.session?.played).toHaveLength(2)
    advance(700)
    expect(result.current.session?.played).toHaveLength(3)
    advance(700)
    expect(result.current.session).toMatchObject({ phase: 'revealed', outcome: 'loss' })
    expect(result.current.session?.played).toHaveLength(4)
  })

  test('retry goes back to after the setup', () => {
    const { result } = mount()
    advance(600)
    act(() => result.current.submit({ from: 'b6', to: 'c7' }))
    expect(result.current.session?.phase).toBe('failed')
    act(() => result.current.retry())
    expect(result.current.session).toMatchObject({ phase: 'solver', played: ['d3d6'], outcome: 'loss' })
  })

  // Breaks if a timer scheduled for the old puzzle advances the new one.
  test('a new key restarts on the new puzzle at once; the old timer is dropped', () => {
    const { result, rerender } = mount()
    advance(300)
    rerender({ s: BACK, k: 'k2' })
    expect(result.current.session).toMatchObject({ phase: 'setup', played: [] })
    expect(result.current.session?.spec).toBe(BACK)
    advance(300)
    expect(result.current.session?.phase).toBe('setup')
    advance(300)
    expect(result.current.session).toMatchObject({ phase: 'solver', played: ['b7b6'] })
  })

  test('no spec, no session', () => {
    const { result } = mount(null, null)
    expect(result.current.session).toBeNull()
    act(() => result.current.hint())
    expect(result.current.hintStage).toBe(0)
  })
})
