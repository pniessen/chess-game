// @vitest-environment node
import { expect, test } from 'vitest'
import { hintPrompt, reviewPrompt } from './prompts'

test('the hint prompt carries the position, the move and the line, and forbids other moves', () => {
  const p = hintPrompt({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    bestMoveSan: 'e4',
    line: ['e4', 'e5', 'Nf3'],
    evaluation: '+0.3',
  })
  expect(p.user).toContain('rnbqkbnr/pppppppp')
  expect(p.user).toContain("Engine's best move: e4")
  expect(p.user).toContain('e4 e5 Nf3')
  expect(p.system).toMatch(/never recommend a different move/i)
  expect(p.maxTokens).toBe(1024)
})

test('the review prompt numbers moves and lists flagged moves with the engine alternative', () => {
  const p = reviewPrompt({
    moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    firstMover: 'w',
    result: '1-0',
    opening: "Bishop's Opening",
    accuracy: { w: 92.5, b: 40.1 },
    flagged: [{ ply: 6, san: 'Nf6', classification: 'blunder', bestSan: 'g6', lossPct: 48.2 }],
    humanSide: 'b',
  })
  expect(p.user).toContain('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#')
  expect(p.user).toContain('3... Nf6: blunder')
  expect(p.user).toContain('the engine preferred g6')
  expect(p.user).toContain('The human played Black')
  expect(p.user).toContain('White 92.5%, Black 40.1%')
})
