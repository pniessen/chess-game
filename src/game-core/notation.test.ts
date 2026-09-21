import { expect, test } from 'vitest'
import { sanTokens, uciOf } from './notation'

test('uciOf', () => {
  expect(uciOf({ from: 'e2', to: 'e4' })).toBe('e2e4')
  expect(uciOf({ from: 'e7', to: 'e8', promotion: 'q' })).toBe('e7e8q')
})

test('sanTokens strips move numbers and results', () => {
  expect(sanTokens('1. e4 e5 2. Nf3 Nc6 3...a6 *')).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'a6'])
  expect(sanTokens('1.e4 e5 2.Nf3 1-0')).toEqual(['e4', 'e5', 'Nf3'])
  expect(sanTokens('  ')).toEqual([])
})
