import { describe, expect, test } from 'vitest'
import { claudeErrorText } from './claudeText'

describe('claudeErrorText', () => {
  test('each refusal has its own reason', () => {
    const texts = (['busy', 'budget', 'forbidden', 'unavailable'] as const).map(claudeErrorText)
    expect(new Set(texts).size).toBe(4)
    expect(claudeErrorText('busy')).toMatch(/already running/)
    expect(claudeErrorText('budget')).toMatch(/budget/)
  })
})
