import { expect, test } from 'vitest'
import { PUZZLE_THEMES, themeLabel } from './themes'

test('the filter list is fixed, unique, and every entry has a label', () => {
  expect(PUZZLE_THEMES).toHaveLength(18)
  expect(new Set(PUZZLE_THEMES).size).toBe(PUZZLE_THEMES.length)
  for (const t of PUZZLE_THEMES) expect(themeLabel(t)).not.toBe('')
})

test('known themes use their label; unknown Lichess themes are humanised', () => {
  expect(themeLabel('mateIn2')).toBe('Mate in 2')
  expect(themeLabel('backRankMate')).toBe('Back-rank mate')
  expect(themeLabel('kingsideAttack')).toBe('Kingside attack')
  expect(themeLabel('mateIn4')).toBe('Mate in 4')
  expect(themeLabel('short')).toBe('Short')
})
