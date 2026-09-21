import { describe, expect, test } from 'vitest'
import { formatClock } from './Clocks'

describe('formatClock', () => {
  test('zero', () => {
    expect(formatClock(0)).toBe('0:00.0')
  })
  test('under ten seconds shows tenths', () => {
    expect(formatClock(9_400)).toBe('0:09.4')
  })
  test('over a minute, no tenths', () => {
    expect(formatClock(65_000)).toBe('1:05')
  })
  test('ten minutes', () => {
    expect(formatClock(600_000)).toBe('10:00')
  })
})
