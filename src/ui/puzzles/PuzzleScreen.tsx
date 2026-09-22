import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board, type Highlights } from '../Board/Board'
import { Promotion } from '../Board/Promotion'
import { reduceSelection, type SelectionState } from '../Board/selection'
import type { Square } from '../../game-core/types'
import { loadPuzzleSet } from '../../puzzles/data'
import { selectPuzzle } from '../../puzzles/select'
import { lastMoveOf, positionOf, solverColorOf } from '../../puzzles/session'
import { specOfRated } from '../../puzzles/spec'
import { loadPuzzleStats, markPuzzleSeen, recordPuzzleResult, type PuzzleStats } from '../../puzzles/store'
import { PUZZLE_THEMES, themeLabel } from '../../puzzles/themes'
import type { RatedPuzzle } from '../../puzzles/types'
import { usePuzzleSession } from './usePuzzleSession'
import {
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
} from './puzzleView'
import './puzzles.css'

type PuzzleSet = { kind: 'loading' } | { kind: 'ready'; puzzles: RatedPuzzle[] } | { kind: 'failed' }

interface Current {
  /** A fresh key per showing, so showing the same puzzle again restarts it. */
  key: string
  puzzle: RatedPuzzle
}

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
  const [set, setSet] = useState<PuzzleSet>({ kind: 'loading' })
  const [stats, setStats] = useState<PuzzleStats>(() => loadPuzzleStats())
  const [theme, setTheme] = useState('')
  const [current, setCurrent] = useState<Current | null>(null)
  const [delta, setDelta] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const seqRef = useRef(0)
  /** The key of the puzzle whose rating result has been recorded. */
  const recordedRef = useRef<string | null>(null)
  const loadRef = useRef(loadPuzzles)
  const randomRef = useRef(random)
  randomRef.current = random

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

  const showRated = useCallback((puzzles: readonly RatedPuzzle[], filter: string, excludeId: string | null) => {
    const s = loadPuzzleStats()
    const pick = selectPuzzle(puzzles, {
      rating: s.rating,
      seen: new Set(s.seen),
      theme: filter || null,
      excludeId,
      random: randomRef.current,
    })
    setDelta(null)
    setSelection({ kind: 'idle' })
    if (!pick) {
      setStats(s)
      setCurrent(null)
      return
    }
    setStats(markPuzzleSeen(pick.id))
    seqRef.current += 1
    setCurrent({ key: `p${seqRef.current}`, puzzle: pick })
  }, [])

  // The first puzzle, once the set arrives. Theme changes and Next draw explicitly.
  useEffect(() => {
    if (set.kind === 'ready') showRated(set.puzzles, theme, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set])

  const spec = useMemo(() => (current ? specOfRated(current.puzzle) : null), [current])
  const puzzle = usePuzzleSession(spec, current?.key ?? null)
  const session = puzzle.session
  const outcome = session?.outcome ?? null

  // Rated: the first decisive event of each showing changes the rating, once.
  useEffect(() => {
    if (!current || outcome === null || recordedRef.current === current.key) return
    recordedRef.current = current.key
    const before = loadPuzzleStats().rating
    const after = recordPuzzleResult(current.puzzle.rating, outcome)
    setStats(after)
    setDelta(after.rating - before)
  }, [current, outcome])

  const position = useMemo(() => (session ? positionOf(session) : null), [session])
  const solver = spec ? solverColorOf(spec) : 'w'
  const phase = session?.phase ?? null
  const last = session ? lastMoveOf(session) : null
  const status = position?.status()

  const onSquareClick = (square: Square) => {
    if (!position || phase !== 'solver') {
      setSelection({ kind: 'idle' })
      return
    }
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    setSelection(out.state)
    if (out.move) puzzle.submit(out.move)
  }

  const handleNext = () => {
    if (set.kind === 'ready') showRated(set.puzzles, theme, current?.puzzle.id ?? null)
  }

  const handleTheme = (next: string) => {
    setTheme(next)
    if (set.kind === 'ready') showRated(set.puzzles, next, null)
  }

  const highlights: Highlights = position
    ? {
        ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
        legal: selection.kind === 'selected' ? position.legalMovesFrom(selection.square).map((m) => m.to) : [],
        ...(last ? { lastMove: [last.from, last.to] as [Square, Square] } : {}),
        ...(status?.kind === 'in-progress' && status.inCheck
          ? { check: position.kingSquare(position.turn()) ?? undefined }
          : {}),
      }
    : {}

  return (
    <main className="app puzzle-screen" data-testid="puzzle-screen">
      <h1>Puzzles</h1>

      <div className="puzzle-toolbar">
        <label className="puzzle-theme-filter">
          Theme{' '}
          <select data-testid="puzzle-theme" value={theme} onChange={(e) => handleTheme(e.target.value)}>
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
        <div className="left-column puzzle-info">
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
            </p>
          </div>
          {current && session ? (
            <div className="puzzle-card puzzle-now">
              <p className={`puzzle-side ${solver === 'w' ? 'white' : 'black'}`} data-testid="puzzle-side-to-move">
                {sideName(solver)} to move
              </p>
              <p className={`puzzle-status phase-${phase}`} data-testid="puzzle-status" aria-live="polite">
                {puzzleStatusText(session, solver)}
              </p>
              <dl className="puzzle-facts">
                <div>
                  <dt>Puzzle rating</dt>
                  <dd data-testid="puzzle-rating">{current.puzzle.rating}</dd>
                </div>
                <div>
                  <dt>Themes</dt>
                  <dd data-testid="puzzle-themes">{current.puzzle.themes.map(themeLabel).join(', ')}</dd>
                </div>
              </dl>
              <span className="sr-only" data-testid="puzzle-id">
                {current.puzzle.id}
              </span>
            </div>
          ) : null}
        </div>

        <div className="board-column">
          {set.kind === 'loading' ? (
            <p className="puzzle-message" data-testid="puzzle-loading">
              Loading puzzles…
            </p>
          ) : null}
          {set.kind === 'failed' ? (
            <p className="puzzle-message puzzle-error" role="alert" data-testid="puzzle-load-error">
              The puzzles could not be loaded. Your game is unaffected — go back to it and try again later.
            </p>
          ) : null}
          {set.kind === 'ready' && !current ? (
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

        <div className="right-column" />
      </div>
    </main>
  )
}
