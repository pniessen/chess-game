import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MatchController, type EngineLike } from '../../match/controller'
import { useMatch } from '../useMatch'
import { useMoveInput } from './useMoveInput'

const noEngine: EngineLike = {
  waitReady: () => Promise.reject(new Error('engine unavailable')),
  configure: () => {},
  newGame: () => {},
  setPosition: () => {},
  search: () => Promise.reject(new Error('engine unavailable')),
  stop: () => {},
  dispose: () => {},
}

function setup() {
  const controller = new MatchController({ engine: noEngine })
  controller.start({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } })
  const hook = renderHook(() => useMoveInput(controller, useMatch(controller)))
  return { controller, hook }
}

describe('useMoveInput', () => {
  test('two clicks submit the move through the controller', () => {
    const { controller, hook } = setup()
    act(() => hook.result.current.onSquareClick('e2'))
    expect(hook.result.current.selection).toEqual({ kind: 'selected', square: 'e2' })
    act(() => hook.result.current.onSquareClick('e4'))
    expect(controller.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
    expect(hook.result.current.selection.kind).toBe('idle')
  })

  // Breaks if undo stops enabling redo, or redo stays enabled after it is used.
  test('undo enables redo; redo restores the move and disables itself', () => {
    const { controller, hook } = setup()
    act(() => hook.result.current.onSquareClick('e2'))
    act(() => hook.result.current.onSquareClick('e4'))
    act(() => hook.result.current.handleUndo())
    expect(controller.snapshot().game.moves).toHaveLength(0)
    expect(hook.result.current.canRedo).toBe(true)
    act(() => hook.result.current.handleRedo())
    expect(controller.snapshot().game.moves).toHaveLength(1)
    expect(hook.result.current.canRedo).toBe(false)
  })

  test('resetInput clears redo and any selection', () => {
    const { hook } = setup()
    act(() => hook.result.current.onSquareClick('e2'))
    act(() => hook.result.current.onSquareClick('e4'))
    act(() => hook.result.current.handleUndo())
    act(() => hook.result.current.onSquareClick('d2'))
    act(() => hook.result.current.resetInput())
    expect(hook.result.current.canRedo).toBe(false)
    expect(hook.result.current.selection.kind).toBe('idle')
  })
})
