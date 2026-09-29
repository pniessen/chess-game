import { describe, expect, test } from 'vitest'
import { claudeErrorText } from './claudeText'

describe('claudeErrorText', () => {
  test('each refusal has its own reason', () => {
    const texts = (['busy', 'budget', 'forbidden', 'unavailable'] as const).map(claudeErrorText)
    expect(new Set(texts).size).toBe(4)
    expect(claudeErrorText('busy')).toMatch(/already running/)
    expect(claudeErrorText('budget')).toMatch(/budget/)
  })

  // Local-only: there is no owner token any more. A begin is refused only by
  // the local server's loopback Origin check, or fails with no server/key.
  test('no refusal mentions an owner token; unavailable says how to start the local server', () => {
    for (const kind of ['busy', 'budget', 'forbidden', 'unavailable'] as const) {
      expect(claudeErrorText(kind)).not.toMatch(/token|Settings/i)
    }
    expect(claudeErrorText('forbidden')).toMatch(/local server/)
    expect(claudeErrorText('unavailable')).toMatch(/npm run server/)
  })
})
