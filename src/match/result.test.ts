import { expect, test } from 'vitest'
import { humanSideOf, resultTagOf } from './result'

const status = { kind: 'in-progress', inCheck: false } as const

test('resultTagOf', () => {
  expect(resultTagOf({ kind: 'finished', status, reason: 'resign', winner: 'w' })).toBe('1-0')
  expect(resultTagOf({ kind: 'finished', status, reason: 'flag', winner: 'b' })).toBe('0-1')
  expect(resultTagOf({ kind: 'finished', status: { kind: 'draw', reason: 'stalemate' }, reason: 'normal', winner: null })).toBe('1/2-1/2')
  expect(resultTagOf({ kind: 'finished', status, reason: 'engine-error', winner: null })).toBe('*')
  expect(resultTagOf({ kind: 'awaiting-human', side: 'w' })).toBe('*')
})

test('humanSideOf', () => {
  const tc = { kind: 'untimed' } as const
  expect(humanSideOf({ white: { kind: 'human' }, black: { kind: 'engine', level: 3 }, timeControl: tc })).toBe('w')
  expect(humanSideOf({ white: { kind: 'engine', level: 3 }, black: { kind: 'human' }, timeControl: tc })).toBe('b')
  expect(humanSideOf({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: tc })).toBeNull()
})
