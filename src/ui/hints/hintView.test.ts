import { describe, expect, test } from 'vitest'
import { hintAnnotations, hintButtonLabel, hintText } from './hintView'
import type { HintSuggestion } from '../../coach/hints'

const s: HintSuggestion = { fen: 'x', from: 'g1', to: 'f3', san: 'Nf3', piece: 'n', lines: [] }

describe('hint view', () => {
  test('stage 0 shows nothing', () => {
    expect(hintAnnotations(0, s)).toEqual([])
    expect(hintText(0, s, null)).toBe('')
  })
  test('stage 1 is a nudge: highlight the piece, name it, no arrow', () => {
    expect(hintAnnotations(1, s)).toEqual([{ kind: 'square', square: 'g1', tone: 'hint' }])
    expect(hintText(1, s, null)).toBe('Look at your knight.')
  })
  test('stage 2 adds the arrow and the move', () => {
    expect(hintAnnotations(2, s)).toEqual([
      { kind: 'square', square: 'g1', tone: 'hint' },
      { kind: 'arrow', from: 'g1', to: 'f3', tone: 'hint' },
    ])
    expect(hintText(2, s, null)).toBe('Look at your knight. Try Nf3.')
  })
  test('stage 3 shows the reasoning and keeps the arrow', () => {
    expect(hintText(3, s, 'Develops and controls e5.')).toBe('Develops and controls e5.')
    expect(hintAnnotations(3, s)).toHaveLength(2)
  })
  test('button labels walk through the grades', () => {
    expect([0, 1, 2, 3].map((n) => hintButtonLabel(n as 0 | 1 | 2 | 3, false))).toEqual([
      'Hint', 'Show move', 'Explain', 'Explained',
    ])
    expect(hintButtonLabel(1, true)).toBe('Thinking…')
  })
})
