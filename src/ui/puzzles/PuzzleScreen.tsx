import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board, type Highlights } from '../Board/Board'
import { Promotion } from '../Board/Promotion'
import { reduceSelection, type SelectionState } from '../Board/selection'
import type { Square } from '../../game-core/types'
import { loadPuzzleSet } from '../../puzzles/data'
import { selectPuzzle } from '../../puzzles/select'
import { positionOf, solverColorOf } from '../../puzzles/session'
import { highlightsFor } from '../app/highlights'
import { specOfBlunder, specOfRated, validateSpec } from '../../puzzles/spec'
import {
  loadBlunderPuzzles,
  loadPuzzleStats,
  markBlunderPuzzleSolved,
  markPuzzleSeen,
  recordPuzzleResult,
  type PuzzleStats,
} from '../../puzzles/store'
import { PUZZLE_THEMES, themeLabel } from '../../puzzles/themes'
import type { BlunderPuzzle, RatedPuzzle } from '../../puzzles/types'
import { MistakesList } from './MistakesList'
import { usePuzzleSession } from './usePuzzleSession'
import {
  lastPlayedMoveOf,
  mistakeOriginText,
  nextMistake,
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
  wrongMoveSquare,
} from './puzzleView'
import './puzzles.css'

type Source = 'rated' | 'mistakes'

/** Guards against an unbounded loop if many picks in a row fail validateSpec. */
const MAX_INVALID_PICKS = 20

type PuzzleSet = { kind: 'loading' } | { kind: 'ready'; puzzles: RatedPuzzle[] } | { kind: 'failed' }

/** A fresh key per showing, so showing the same puzzle again restarts it. */
type Current =
  | { source: 'rated'; key: string; puzzle: RatedPuzzle }
  | { source: 'mistakes'; key: string; puzzle: BlunderPuzzle }

export interface PuzzleScreenProps {
  onExit: () => void
  themeId: string
  pieceSetId: string
  /** Injectable for tests; defaults to the lazily fetched bundled set. */
  loadPuzzles?: () => Promise<RatedPuzzle[] | null>
  /** Selection RNG; e2e pins Math.random. */
  random?: () => number
}

export function PuzzleScreen({
  onExit,
  themeId,
  pieceSetId,
  loadPuzzles = loadPuzzleSet,
  random = Math.random,
}: PuzzleScreenProps) {
  const [source, setSource] = useState<Source>('rated')
  const [set, setSet] = useState<PuzzleSet>({ kind: 'loading' })
  const [stats, setStats] = useState<PuzzleStats>(() => loadPuzzleStats())
  const [mistakes, setMistakes] = useState<BlunderPuzzle[]>(() => loadBlunderPuzzles())
  const [theme, setTheme] = useState('')
  const [current, setCurrent] = useState<Current | null>(null)
  const [delta, setDelta] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const seqRef = useRef(0)
  /** The key of the rated showing whose result has been recorded. */
  const recordedRef = useRef<string | null>(null)
  const loadRef = useRef(loadPuzzles)
  const randomRef = useRef(random)
  randomRef.current = random
  // Kept live every render (same pattern as randomRef above), so the
  // set-arrival effect below — which intentionally does NOT re-run on every
  // source/theme change (see its own comment) — can still always read what
  // the user is ACTUALLY on right now, not whatever `source`/`theme` were
  // at the render that last scheduled it.
  const sourceRef = useRef(source)
  sourceRef.current = source
  const themeRef = useRef(theme)
  themeRef.current = theme

  // Fetched once per open (the loader caches; a failure is retried next time).
  useEffect(() => {
    let live = true
    void loadRef.current().then((puzzles) => {
      if (live) setSet(puzzles ? { kind: 'ready', puzzles } : { kind: 'failed' })
    })
    return () => {
      live = false
    }
  }, [])

  const nextKey = useCallback(() => {
    seqRef.current += 1
    return `p${seqRef.current}`
  }, [])

  const showRated = useCallback(
    (puzzles: readonly RatedPuzzle[], filter: string, excludeId: string | null) => {
      // A puzzle that fails validateSpec (a bad FEN, an illegal move in the
      // line, ...) is never shown — it is marked seen and skipped instead,
      // bounded so a run of bad data can't loop forever.
      let s = loadPuzzleStats()
      let pick: RatedPuzzle | null = null
      for (let attempt = 0; attempt < MAX_INVALID_PICKS; attempt++) {
        const candidate = selectPuzzle(puzzles, {
          rating: s.rating,
          seen: new Set(s.seen),
          theme: filter || null,
          excludeId,
          random: randomRef.current,
        })
        if (!candidate) break
        if (validateSpec(specOfRated(candidate)) === null) {
          pick = candidate
          break
        }
        s = markPuzzleSeen(candidate.id)
      }
      setDelta(null)
      setSelection({ kind: 'idle' })
      if (!pick) {
        setStats(s)
        setCurrent(null)
        return
      }
      setStats(markPuzzleSeen(pick.id))
      setCurrent({ source: 'rated', key: nextKey(), puzzle: pick })
    },
    [nextKey],
  )

  const showMistake = useCallback(
    (p: BlunderPuzzle | null) => {
      setDelta(null)
      setSelection({ kind: 'idle' })
      setCurrent(p ? { source: 'mistakes', key: nextKey(), puzzle: p } : null)
    },
    [nextKey],
  )

  // The first rated puzzle, once the set arrives (if the user is still on
  // Rated). Deliberately keyed on `[set]` alone — this must fire exactly
  // once, when the fetch resolves, not on every later source/theme change
  // (those are each already handled by their own call site: changeSource,
  // handleTheme). But that means it can run at an arbitrary later time
  // relative to the render that scheduled it — a passive effect is not
  // guaranteed to flush before the very next discrete event — so reading
  // `source`/`theme` from the closure here would silently act on whatever
  // they were AT THAT EARLIER RENDER, not on what the user is actually on
  // when the effect body runs. A real case: open Puzzles, switch to My
  // mistakes before puzzles.json has finished loading — when it resolves,
  // this effect used to see the closure's stale `source === 'rated'` and
  // call showRated, silently overwriting the mistakes puzzle the user
  // asked for even though the dropdown still read "My mistakes" — reported
  // from a real browser, and the suspected root cause of a flaky e2e test
  // (tests/e2e/puzzle-celebration.spec.ts's "My mistakes..." test, flaky
  // only under full-suite CPU contention). `sourceRef`/`themeRef` (kept
  // live every render, just above) fix that: they always read the CURRENT
  // source/theme at the moment the set actually arrives, never a frozen
  // closure. See PuzzleScreen.race.test.tsx for the full account,
  // including why that test cannot itself force the pre-fix code to fail
  // in this test harness — the fix is kept on the strength of the direct
  // real-browser report, not a red/green unit test.
  useEffect(() => {
    if (set.kind === 'ready' && sourceRef.current === 'rated') showRated(set.puzzles, themeRef.current, null)
  }, [set, showRated])

  const spec = useMemo(
    () =>
      current === null ? null : current.source === 'rated' ? specOfRated(current.puzzle) : specOfBlunder(current.puzzle),
    [current],
  )
  const puzzle = usePuzzleSession(spec, current?.key ?? null)
  const session = puzzle.session
  const outcome = session?.outcome ?? null
  const phase = session?.phase ?? null

  // Rated only: the first decisive event of each showing changes the rating, once.
  useEffect(() => {
    if (current?.source !== 'rated' || outcome === null || recordedRef.current === current.key) return
    recordedRef.current = current.key
    const before = loadPuzzleStats().rating
    const after = recordPuzzleResult(current.puzzle.rating, outcome)
    setStats(after)
    setDelta(after.rating - before)
  }, [current, outcome])

  // My mistakes: solving one marks it solved (hint or retry allowed — it is practice).
  useEffect(() => {
    if (current?.source !== 'mistakes' || phase !== 'solved') return
    setMistakes(markBlunderPuzzleSolved(current.puzzle.id))
  }, [current, phase])

  const position = useMemo(() => (session ? positionOf(session) : null), [session])
  // Memoised on the session so the board sees one stable move record per
  // step, not a fresh one on every render.
  const played = useMemo(() => (session ? lastPlayedMoveOf(session) : null), [session])
  const solver = spec ? solverColorOf(spec) : 'w'
  const rated = current?.source === 'rated' ? current.puzzle : null
  const mistake = current?.source === 'mistakes' ? current.puzzle : null

  const onSquareClick = (square: Square) => {
    if (!position || phase !== 'solver') {
      setSelection({ kind: 'idle' })
      return
    }
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    setSelection(out.state)
    if (out.move) puzzle.submit(out.move)
  }

  const changeSource = (next: Source) => {
    if (next === source) return
    setSource(next)
    if (next === 'mistakes') {
      const list = loadBlunderPuzzles()
      setMistakes(list)
      showMistake(nextMistake(list, null))
    } else if (set.kind === 'ready') {
      showRated(set.puzzles, theme, null)
    } else {
      showMistake(null)
    }
  }

  const handleNext = () => {
    if (source === 'mistakes') showMistake(nextMistake(mistakes, current?.puzzle.id ?? null))
    else if (set.kind === 'ready') showRated(set.puzzles, theme, current?.puzzle.id ?? null)
  }

  const handleTheme = (next: string) => {
    setTheme(next)
    if (source === 'rated' && set.kind === 'ready') showRated(set.puzzles, next, null)
  }

  // Shared with the main game board (src/ui/app/highlights.ts) rather than
  // recomputed here — a duplicated `status.kind === 'in-progress'` check
  // once let the check glow vanish on checkmate on this screen only, while
  // the main board's copy got fixed. `played` (lastPlayedMoveOf) is the
  // same move `lastMoveOf` would report, already in the shape highlightsFor
  // wants.
  const highlights: Highlights = position
    ? {
        ...highlightsFor({
          selection,
          position,
          lastMove: played ?? undefined,
          displayedStatus: position.status(),
        }),
        // Task 7 (presentation only — reads `phase`/`session`, never
        // decides them): the ring sweeps once on the phase that means the
        // user actually solved it, for both rated and My-mistakes puzzles.
        // "Show solution" lands on 'revealed', not 'solved', so it never
        // celebrates.
        ...(phase === 'solved' ? { celebrate: true } : {}),
        ...(session ? { wrongMove: wrongMoveSquare(session) ?? undefined } : {}),
      }
    : {}

  return (
    <main className="app puzzle-screen" data-testid="puzzle-screen">
      <h1>Puzzles</h1>

      <div className="puzzle-toolbar">
        <label className="puzzle-source-switch">
          Puzzles{' '}
          <select data-testid="puzzle-source" value={source} onChange={(e) => changeSource(e.target.value as Source)}>
            <option value="rated">Rated (Lichess)</option>
            <option value="mistakes">My mistakes</option>
          </select>
        </label>
        <label className="puzzle-theme-filter">
          Theme{' '}
          <select
            data-testid="puzzle-theme"
            value={theme}
            disabled={source !== 'rated'}
            onChange={(e) => handleTheme(e.target.value)}
          >
            <option value="">All themes</option>
            {PUZZLE_THEMES.map((t) => (
              <option key={t} value={t}>
                {themeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="puzzle-exit" onClick={onExit}>
          Back to game
        </button>
      </div>

      <div className="layout">
        <div className={`left-column puzzle-info${source === 'mistakes' ? ' mistakes-mode' : ''}`}>
          {source === 'rated' ? (
            <div className="puzzle-card puzzle-you">
              <p className="puzzle-label">Your puzzle rating</p>
              <p className="puzzle-rating-line">
                <span className="puzzle-big" data-testid="user-puzzle-rating">
                  {stats.rating}
                </span>
                {delta !== null ? (
                  <span data-testid="puzzle-rating-delta" className={delta >= 0 ? 'rating-up' : 'rating-down'}>
                    {' '}
                    ({ratingDeltaText(delta)})
                  </span>
                ) : null}
                {/* Task 7: a transient rising, fading echo of the same
                    number — purely decorative (the span above already
                    carries the persisted, always-visible text a screen
                    reader or reduced-motion user needs), so aria-hidden and
                    keyed to the showing: a fresh attempt always replays it,
                    even when the delta happens to repeat a prior value. */}
                {delta !== null ? (
                  <span
                    key={current?.key}
                    className={`rating-pop ${delta >= 0 ? 'rating-up' : 'rating-down'}`}
                    aria-hidden="true"
                  >
                    {ratingDeltaText(delta)}
                  </span>
                ) : null}
              </p>
            </div>
          ) : (
            <div className="puzzle-card puzzle-you puzzle-practice">
              <p className="puzzle-label">Practice</p>
              <p className="puzzle-unrated" data-testid="puzzle-unrated">
                Practice — your puzzle rating ({stats.rating}) is not affected.
              </p>
            </div>
          )}
          {current && session ? (
            <div className="puzzle-card puzzle-now">
              <p className={`puzzle-side ${solver === 'w' ? 'white' : 'black'}`} data-testid="puzzle-side-to-move">
                {sideName(solver)} to move
              </p>
              <p className={`puzzle-status phase-${phase}`} data-testid="puzzle-status" aria-live="polite">
                {puzzleStatusText(session, solver)}
              </p>
              {rated ? (
                <>
                  <dl className="puzzle-facts">
                    <div>
                      <dt>Puzzle rating</dt>
                      <dd data-testid="puzzle-rating">{rated.rating}</dd>
                    </div>
                    <div>
                      <dt>Themes</dt>
                      <dd data-testid="puzzle-themes">{rated.themes.map(themeLabel).join(', ')}</dd>
                    </div>
                  </dl>
                  <span className="sr-only" data-testid="puzzle-id">
                    {rated.id}
                  </span>
                </>
              ) : null}
              {mistake ? (
                <p className="puzzle-origin" data-testid="puzzle-origin">
                  {mistakeOriginText(mistake)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="board-column">
          {source === 'rated' && set.kind === 'loading' ? (
            <p className="puzzle-message" data-testid="puzzle-loading">
              Loading puzzles…
            </p>
          ) : null}
          {source === 'rated' && set.kind === 'failed' ? (
            <p className="puzzle-message puzzle-error" role="alert" data-testid="puzzle-load-error">
              The puzzles could not be loaded. Your game is unaffected — go back to it and try again later.
            </p>
          ) : null}
          {source === 'rated' && set.kind === 'ready' && !current ? (
            <p className="puzzle-message" data-testid="puzzle-empty">
              No puzzles match this theme.
            </p>
          ) : null}
          {position && session ? (
            <div className="board-row">
              <Board
                position={position}
                orientation={solver === 'w' ? 'white' : 'black'}
                highlights={highlights}
                onSquareClick={onSquareClick}
                annotations={puzzleAnnotations(session, puzzle.hintStage)}
                theme={themeId}
                pieceSet={pieceSetId}
                lastPlayed={played}
              />
            </div>
          ) : null}
          {selection.kind === 'awaiting-promotion' && position ? (
            <Promotion
              color={position.turn()}
              pieceSet={pieceSetId}
              onChoose={(piece) => {
                const out = reduceSelection(selection, { kind: 'promotion-chosen', piece }, position)
                setSelection(out.state)
                if (out.move) puzzle.submit(out.move)
              }}
              onCancel={() => setSelection({ kind: 'idle' })}
            />
          ) : null}
          {current && session ? (
            <div className="controls puzzle-panel">
              <div className="puzzle-controls">
                <button
                  type="button"
                  data-testid="puzzle-retry"
                  onClick={puzzle.retry}
                  disabled={phase !== 'failed' && phase !== 'solved' && phase !== 'revealed'}
                >
                  Retry
                </button>
                <button
                  type="button"
                  data-testid="puzzle-hint"
                  onClick={puzzle.hint}
                  disabled={phase !== 'solver' || puzzle.hintStage >= 2}
                >
                  {puzzleHintButtonLabel(puzzle.hintStage)}
                </button>
                <button
                  type="button"
                  data-testid="puzzle-solution"
                  onClick={puzzle.showSolution}
                  disabled={phase !== 'solver' && phase !== 'failed'}
                >
                  Show solution
                </button>
                <button type="button" data-testid="puzzle-next" onClick={handleNext}>
                  Next
                </button>
              </div>
              <p className="hint-text" data-testid="puzzle-hint-text" aria-live="polite">
                {puzzleHintText(session, puzzle.hintStage)}
              </p>
            </div>
          ) : null}
        </div>

        <div className="right-column">
          {source === 'mistakes' ? (
            <div className="puzzle-card mistakes-panel">
              <p className="puzzle-label">My mistakes</p>
              <MistakesList puzzles={mistakes} currentId={mistake?.id ?? null} onPick={showMistake} />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
