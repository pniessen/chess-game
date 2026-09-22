import { describe, expect, test } from 'vitest'
import {
  expectedMove,
  lastMoveOf,
  noteHint,
  playReply,
  playSetup,
  playSolutionStep,
  positionOf,
  retrySession,
  revealSolution,
  solverColorOf,
  startSession,
  submitMove,
  type PuzzleSession,
} from './session'
import { specOfRated } from './spec'
import type { PuzzleSpec } from './types'
import { BACK_RANK, DEFENCE, MULTI } from '../../tests/fixtures/puzzles'

const DEF = specOfRated(DEFENCE)
const ready = (spec: PuzzleSpec) => playSetup(startSession(spec))
const play = (s: PuzzleSession, uci: string) =>
  submitMove(s, { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) } as never)

describe('setup', () => {
  test('a Lichess puzzle starts before the setup move, from the solver side', () => {
    const s = startSession(DEF)
    expect(s).toMatchObject({ phase: 'setup', played: [], step: 0, outcome: null, wrongMove: null })
    expect(positionOf(s).fen()).toBe(DEFENCE.fen)
    expect(solverColorOf(DEF)).toBe('b')
    expect(expectedMove(s)).toBeNull()
  })

  // Breaks if the setup move is skipped or counted as the solver's.
  test('playSetup plays moves[0] and hands the move to the solver', () => {
    const s = ready(DEF)
    expect(s).toMatchObject({ phase: 'solver', played: ['d3d6'], step: 0 })
    expect(positionOf(s).turn()).toBe('b')
    expect(lastMoveOf(s)).toEqual({ from: 'd3', to: 'd6' })
    expect(expectedMove(s)).toEqual({ from: 'f8', to: 'd8' })
  })

  test('a spec without a setup starts on the solver', () => {
    const s = startSession({ fen: DEFENCE.fen, setup: null, solution: ['d3d6'] })
    expect(s.phase).toBe('solver')
    expect(solverColorOf(s.spec)).toBe('w')
  })

  test('moves are ignored before the setup has been played', () => {
    const s = startSession(DEF)
    expect(play(s, 'd3d6')).toEqual({ session: s, verdict: 'ignored' })
  })
})

describe('solving', () => {
  // Breaks if the opponent's reply is not waited for, or the last move does not end the puzzle.
  test('correct, opponent reply, correct: solved, first try is a win', () => {
    const a = play(ready(DEF), 'f8d8')
    expect(a.verdict).toBe('correct')
    expect(a.session.phase).toBe('reply')
    const b = playReply(a.session)
    expect(b).toMatchObject({ phase: 'solver', step: 2, played: ['d3d6', 'f8d8', 'd6d8'] })
    const c = play(b, 'f6d8')
    expect(c.verdict).toBe('solved')
    expect(c.session).toMatchObject({ phase: 'solved', outcome: 'win', step: 3 })
    expect(positionOf(c.session).fen()).toBe('3b2k1/1p3ppp/pq6/8/8/1P3N2/P4PPP/3R2K1 w - - 0 29')
  })

  test('a three-move line with two replies (Lichess 00008)', () => {
    let s = ready(specOfRated(MULTI))
    for (const [mine, reply] of [['e6e7', 'b2b1'], ['b3c1', 'b1c1']] as const) {
      const out = play(s, mine)
      expect(out.verdict).toBe('correct')
      s = playReply(out.session)
      expect(s.played.at(-1)).toBe(reply)
    }
    expect(play(s, 'h6c1').session.phase).toBe('solved')
  })

  // Breaks if only the listed move is accepted (the Lichess any-mate rule).
  test('any checkmate solves, even when it is not the listed move', () => {
    const s = ready(specOfRated(BACK_RANK))
    const alt = play(s, 'a1a8')
    expect(alt.verdict).toBe('solved')
    expect(alt.session.outcome).toBe('win')
    expect(play(s, 'd1d8').verdict).toBe('solved')
    expect(play(s, 'd1d7').verdict).toBe('wrong')
  })

  test('an illegal move changes nothing', () => {
    const s = ready(DEF)
    expect(play(s, 'a6a4')).toEqual({ session: s, verdict: 'illegal' })
  })

  test('moves are ignored while the reply is pending and after the end', () => {
    const r = play(ready(DEF), 'f8d8').session
    expect(play(r, 'g8h8').verdict).toBe('ignored')
    const done = play(playReply(r), 'f6d8').session
    expect(play(done, 'g8f8').verdict).toBe('ignored')
  })
})

describe('failing, retrying and the once-only outcome', () => {
  // Breaks if the wrong move is hidden or the loss is not recorded at once.
  test('a wrong move stays on the board, fails the puzzle and decides a loss', () => {
    const out = play(ready(DEF), 'b6c7')
    expect(out.verdict).toBe('wrong')
    expect(out.session).toMatchObject({ phase: 'failed', wrongMove: 'b6c7', outcome: 'loss' })
    expect(positionOf(out.session).fen()).toBe('5rk1/1pq2ppp/p2Q1b2/8/8/1P3N2/P4PPP/3R2K1 w - - 4 28')
  })

  // Breaks if a retry wipes the loss (free rating by retrying).
  test('retry returns to after the setup; solving then stays a loss', () => {
    const failed = play(ready(DEF), 'b6c7').session
    const again = retrySession(failed)
    expect(again).toMatchObject({ phase: 'solver', played: ['d3d6'], step: 0, wrongMove: null, outcome: 'loss' })
    const solved = play(playReply(play(again, 'f8d8').session), 'f6d8').session
    expect(solved).toMatchObject({ phase: 'solved', outcome: 'loss' })
  })

  test('a hint decides a loss, but only on the solver turn', () => {
    expect(noteHint(ready(DEF)).outcome).toBe('loss')
    const setup = startSession(DEF)
    expect(noteHint(setup)).toBe(setup)
  })

  // Breaks if revealing (or hinting) after a clean solve takes the win away.
  test('after a clean solve the win is kept whatever happens next', () => {
    const won = play(ready(specOfRated(BACK_RANK)), 'd1d8').session
    expect(revealSolution(won).outcome).toBe('win')
    expect(noteHint(retrySession(won)).outcome).toBe('win')
  })

  test('retry is refused during setup and playback', () => {
    const setup = startSession(DEF)
    expect(retrySession(setup)).toBe(setup)
    const showing = revealSolution(ready(DEF))
    expect(retrySession(showing)).toBe(showing)
  })
})

describe('show solution', () => {
  // Breaks if playback starts mid-line or never reaches 'revealed'.
  test('replays the whole solution from after the setup, one move per step', () => {
    let s = revealSolution(play(ready(DEF), 'b6c7').session)
    expect(s).toMatchObject({ phase: 'showing', played: ['d3d6'], step: 0, wrongMove: null, outcome: 'loss' })
    s = playSolutionStep(s)
    expect(s).toMatchObject({ phase: 'showing', played: ['d3d6', 'f8d8'] })
    s = playSolutionStep(playSolutionStep(s))
    expect(s.phase).toBe('revealed')
    expect(positionOf(s).fen()).toBe('3b2k1/1p3ppp/pq6/8/8/1P3N2/P4PPP/3R2K1 w - - 0 29')
    expect(playSolutionStep(s)).toBe(s)
  })

  test('revealing before any move is a loss', () => {
    expect(revealSolution(ready(DEF)).outcome).toBe('loss')
  })
})

test('a corrupt spec never throws: positionOf falls back to the puzzle start or the initial position', () => {
  const s = { ...ready(DEF), played: ['a1a8'] }
  expect(positionOf(s).fen()).toBe(DEFENCE.fen)
  expect(positionOf(startSession({ fen: 'garbage', setup: null, solution: ['e2e4'] })).fen()).toBe(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  )
})

describe('promotion and mid-line mates (added beyond the brief)', () => {
  // Breaks if the promotion piece is dropped from the UCI comparison.
  test('a promotion in the solution must name the listed piece', () => {
    const spec: PuzzleSpec = { fen: '8/4P1k1/8/8/8/8/8/K7 w - - 0 1', setup: null, solution: ['e7e8q'] }
    const s = startSession(spec)
    expect(play(s, 'e7e8')).toEqual({ session: s, verdict: 'illegal' })
    expect(play(s, 'e7e8r')).toMatchObject({ verdict: 'wrong', session: { wrongMove: 'e7e8r' } })
    const ok = play(s, 'e7e8q')
    expect(ok.verdict).toBe('solved')
    expect(positionOf(ok.session).fen()).toBe('4Q3/6k1/8/8/8/8/8/K7 b - - 0 1')
  })

  test('a promotion mid-line is replayed by the reply and by show solution', () => {
    const spec: PuzzleSpec = {
      fen: '8/4P1k1/8/8/8/8/8/K7 w - - 0 1',
      setup: null,
      solution: ['e7e8q', 'g7f6', 'e8e1'],
    }
    const s = playReply(play(startSession(spec), 'e7e8q').session)
    expect(s).toMatchObject({ phase: 'solver', step: 2, played: ['e7e8q', 'g7f6'] })
    expect(expectedMove(s)).toEqual({ from: 'e8', to: 'e1' })
    let shown = revealSolution(s)
    for (let i = 0; i < 3; i++) shown = playSolutionStep(shown)
    expect(shown).toMatchObject({ phase: 'revealed', played: ['e7e8q', 'g7f6', 'e8e1'] })
  })

  // Breaks if a mate that is not the listed move only counts on the final solver move.
  test('a checkmate before the end of the listed line solves at once', () => {
    const spec: PuzzleSpec = {
      fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
      setup: null,
      solution: ['a1a7', 'h7h6', 'a7a8'],
    }
    const out = play(startSession(spec), 'a1a8')
    expect(out.verdict).toBe('solved')
    expect(out.session).toMatchObject({ phase: 'solved', outcome: 'win', step: 1 })
    expect(positionOf(out.session).status().kind).toBe('checkmate')
  })

  test('a non-mating alternative on a mate-in-one is still wrong', () => {
    const s = ready(specOfRated(BACK_RANK))
    const out = play(s, 'a1a7')
    expect(out.verdict).toBe('wrong')
  })
})
