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

  // The board animates a move by comparing the position it is showing with
  // the one it is handed. Undo, redo and a jump can all hand it a position
  // that is exactly one ply on — indistinguishable from a move — so each
  // bumps `cutKey` to say "snap to this, do not animate into it".
  test('undo, redo, a jump and a reset each ask the board to cut', () => {
    const { hook } = setup()
    act(() => hook.result.current.onSquareClick('e2'))
    act(() => hook.result.current.onSquareClick('e4'))
    const afterMove = hook.result.current.cutKey

    act(() => hook.result.current.handleUndo())
    const afterUndo = hook.result.current.cutKey
    expect(afterUndo).not.toBe(afterMove)

    act(() => hook.result.current.handleRedo())
    const afterRedo = hook.result.current.cutKey
    expect(afterRedo).not.toBe(afterUndo)

    act(() => hook.result.current.handleJump(0))
    const afterJump = hook.result.current.cutKey
    expect(afterJump).not.toBe(afterRedo)

    act(() => hook.result.current.resetInput())
    expect(hook.result.current.cutKey).not.toBe(afterJump)
  })

  // The whole point: a played move must look different from a jump.
  test('playing a move leaves cutKey alone, so the move animates', () => {
    const { hook } = setup()
    const before = hook.result.current.cutKey
    act(() => hook.result.current.onSquareClick('e2'))
    act(() => hook.result.current.onSquareClick('e4'))
    expect(hook.result.current.cutKey).toBe(before)
  })
})
