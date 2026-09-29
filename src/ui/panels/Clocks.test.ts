import { describe, expect, test } from 'vitest'
import { formatClock, formatModelTime } from './Clocks'

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

describe('formatModelTime', () => {
  test('always m:ss.t, tenths included past ten seconds and a minute', () => {
    expect(formatModelTime(0)).toBe('0:00.0')
    expect(formatModelTime(3_950)).toBe('0:03.9')
    expect(formatModelTime(65_430)).toBe('1:05.4')
    expect(formatModelTime(600_000)).toBe('10:00.0')
  })
})
