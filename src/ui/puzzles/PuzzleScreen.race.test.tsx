import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PuzzleScreen } from './PuzzleScreen'
import type { RatedPuzzle } from '../../puzzles/types'
import { DEFENCE } from '../../../tests/fixtures/puzzles'

beforeEach(() => {
  localStorage.clear()
})

/**
 * A `.then()`-only thenable whose fulfillment handler can be invoked
 * SYNCHRONOUSLY, on demand — unlike a real Promise, whose `.then()`
 * callback only ever runs as a microtask. `PuzzleScreen.tsx` only ever does
 * `loadPuzzles().then(cb)` (no rejection handler, no chaining), so this is
 * a drop-in stand-in for `loadPuzzles`'s return value here, used to force
 * the fetch's resolution and the user's source switch into the same
 * synchronous window below.
 */
function manualThenable<T>(): { then: (onFulfilled: (value: T) => void) => void; resolve: (value: T) => void } {
  let onFulfilled: ((value: T) => void) | null = null
  return {
    then(cb) {
      onFulfilled = cb
    },
    resolve(value) {
      onFulfilled?.(value)
    },
  }
}

const SEEDED_MISTAKE = {
  v: 1,
  puzzles: [
    {
      id: 'b:6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - -',
      fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
      solution: 'd1d8',
      bestSan: 'Qd8#',
      blunderLabel: '25. h3',
      solver: 'w',
      gameId: 'g1',
      gameDate: '2026-09-20T10:00:00.000Z',
      opening: null,
      createdAt: '2026-09-20T10:05:00.000Z',
      solved: false,
    },
  ],
}

/**
 * Behavioural contract for PuzzleScreen.tsx's set-arrival effect
 * (`useEffect(() => { if (set.kind === 'ready' && sourceRef.current ===
 * 'rated') showRated(...) }, [set, showRated])`): switching to My mistakes
 * while the rated puzzle set is still loading, then having that fetch
 * resolve, must never silently revert the screen back to a rated puzzle.
 *
 * Backstory (read before touching this effect again): the pre-fix version
 * read `source`/`theme` from the closure instead of `sourceRef.current`/
 * `themeRef.current`. That effect is deliberately keyed on `[set]` alone —
 * it must fire exactly once, when the fetch resolves, not on every later
 * source/theme change (those already have their own call sites:
 * changeSource, handleTheme) — which means a closure read is frozen at
 * whichever render last saw `set` change, not necessarily the render at
 * the moment the effect body actually runs. A coordinator reproduced the
 * resulting bug manually in a real browser (open Puzzles, switch to My
 * mistakes before puzzles.json has finished loading; when it resolves, the
 * screen silently reverts to a rated puzzle) and it was the root cause of
 * a genuinely flaky e2e test (tests/e2e/puzzle-celebration.spec.ts's "My
 * mistakes..." test, flaky only under full-suite CPU contention).
 *
 * IMPORTANT — what this test does and does not prove: it exercises the
 * exact "switch while loading, then the fetch resolves" scenario end to
 * end, and passes against the fixed code below. It does NOT fail against
 * the pre-fix (closure-reading) effect. That was verified directly: the
 * pre-fix code was temporarily restored and this test still passed,
 * across eight independent techniques for trying to force the interleaving
 * the real bug needs (synchronous batching via a manual thenable exactly
 * as below; two separate synchronous `act()` calls; `ReactDOM.flushSync`
 * with separate calls for the resolve and the switch; the same again
 * wrapped in `<StrictMode>`; a raw, un-act-wrapped `dispatchEvent` with
 * `IS_REACT_ACT_ENVIRONMENT` set to `false` so React stops eagerly
 * flushing passive effects for test determinism; the same again paced
 * with real `requestAnimationFrame` yields instead of `setTimeout`; and
 * both orderings — switch-then-resolve and resolve-then-switch — of each).
 * In every configuration, React always resolved `source` to its
 * contemporaneous value at the moment the set-arrival effect's condition
 * was actually evaluated: either a not-yet-committed update it coalesces
 * with the latest state before ever rendering, or — when the effect does
 * commit and fire independently first (observed only with real rAF
 * pacing, resolve-before-switch) — a legitimate reading of `source` before
 * any switch had happened, which is not a bug. The effect is keyed on
 * `[set]` alone specifically so it fires at most once per fetch, so there
 * is no SECOND, later firing left for a genuinely stale closure to reach —
 * closures captured by earlier renders were never observed to be invoked
 * after a later render had already committed a different `source` in this
 * test environment (jsdom via @testing-library/react, and real Chromium
 * via Playwright with both an artificial route delay and real, unmocked
 * page-load contention — see the Task 7 fix-round report for the full
 * account). The ref-based fix is still correct and kept: it is a strictly
 * safer pattern (no closure over rapidly-changing state in a
 * sparse-dependency effect) regardless of whether this harness can force
 * the exact real-browser scheduling gap the bug needs, and a coordinator
 * directly observed the bug in a real browser. If this effect is ever
 * restructured, re-attempt reproducing the failure against the OLD code
 * before trusting a green run here as proof of anything beyond "this
 * scenario still ends up correct."
 */
describe('PuzzleScreen: switching to My mistakes while the rated fetch is still pending', () => {
  test('the fetch resolving afterwards never reverts the screen to a rated puzzle', () => {
    localStorage.setItem('chess-game:blunder-puzzles', JSON.stringify(SEEDED_MISTAKE))
    const puzzles = manualThenable<RatedPuzzle[] | null>()
    const onExit = vi.fn()
    render(
      <PuzzleScreen
        onExit={onExit}
        themeId="classic"
        pieceSetId="rhosgfx"
        loadPuzzles={() => puzzles as unknown as Promise<RatedPuzzle[] | null>}
        random={() => 0}
      />,
    )
    // The mount effect has called `puzzles.then(cb)`, storing `cb`; the
    // fetch is still "pending" (set.kind === 'loading').

    act(() => {
      puzzles.resolve([DEFENCE])
      fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    })

    expect(screen.getByTestId('puzzle-source')).toHaveValue('mistakes')
    expect(screen.getByTestId('puzzle-origin')).toHaveTextContent('you played 25. h3??')
    expect(screen.queryByTestId('puzzle-id')).not.toBeInTheDocument()
  })
})
