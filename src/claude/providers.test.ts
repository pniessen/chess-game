import { describe, expect, test } from 'vitest'
import { CLAUDE_MODELS, type ClaudeModelKey } from './models'
import { keyNameFor, providerOf, seatLabel } from './providers'

const KEYS = Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]

describe('providers', () => {
  test('Jev is the one TypeSafe model; the Claude models are Anthropic', () => {
    expect(Object.fromEntries(KEYS.map((k) => [k, providerOf(k)]))).toEqual({
      fable: 'anthropic',
      opus: 'anthropic',
      sonnet: 'anthropic',
      haiku: 'anthropic',
      jev: 'typesafe',
      'gemini-pro': 'vertex',
      'gemini-flash': 'vertex',
    })
  })

  test('each provider names the key the local server needs', () => {
    expect(keyNameFor('jev')).toBe('TYPESAFE_API_KEY')
    expect(keyNameFor('gemini-pro')).toBe('Google ADC')
    expect(keyNameFor('gemini-flash')).toBe('Google ADC')
    for (const k of KEYS.filter((k) => providerOf(k) === 'anthropic')) expect(keyNameFor(k)).toBe('ANTHROPIC_API_KEY')
  })

  test('the seat label adds the maker where the model label lacks it', () => {
    expect(seatLabel('jev')).toBe('TypeSafe Jev')
    expect(seatLabel('opus')).toBe('Claude Opus 5.5')
    expect(seatLabel('gemini-flash')).toBe('Gemini 3.6 Flash')
  })
})
