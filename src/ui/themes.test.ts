import { expect, test } from 'vitest'
import { BOARD_THEMES, boardTheme } from './themes'

test('four themes with distinct ids, classic first', () => {
  expect(BOARD_THEMES.map((t) => t.id)).toEqual(['classic', 'green', 'blue', 'slate'])
})

test('unknown ids fall back to classic (e.g. a setting saved by a future version)', () => {
  expect(boardTheme('green').dark).toBe('#769656')
  expect(boardTheme('neon').id).toBe('classic')
})
