import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getOwnerToken } from '../../claude/ownerToken'
import { useOwnerToken } from './useOwnerToken'

const FAKE = 'fake-owner-token-for-tests'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllEnvs())

describe('useOwnerToken', () => {
  test('reads "not set" at first, "set" after save, and "not set" after clear', () => {
    const { result } = renderHook(() => useOwnerToken())
    expect(result.current.enabled).toBe(true)
    expect(result.current.isSet).toBe(false)
    act(() => result.current.save(FAKE))
    expect(result.current.isSet).toBe(true)
    expect(getOwnerToken()).toBe(FAKE)
    act(() => result.current.clear())
    expect(result.current.isSet).toBe(false)
    expect(getOwnerToken()).toBeNull()
  })

  test('a token already stored reads as set on mount', () => {
    localStorage.setItem('chess.ownerToken', FAKE)
    const { result } = renderHook(() => useOwnerToken())
    expect(result.current.isSet).toBe(true)
  })

  test('saving blank (or only spaces) stores nothing', () => {
    const { result } = renderHook(() => useOwnerToken())
    act(() => result.current.save('   '))
    expect(result.current.isSet).toBe(false)
    expect(getOwnerToken()).toBeNull()
  })

  test('surrounding whitespace is trimmed off a pasted token', () => {
    const { result } = renderHook(() => useOwnerToken())
    act(() => result.current.save(`  ${FAKE}\n`))
    expect(getOwnerToken()).toBe(FAKE)
  })

  // Red if a coaching-off build (GitHub Pages) offers the Claude mode.
  test('with coaching off for the build it is disabled and never reads as set', () => {
    vi.stubEnv('VITE_COACH', 'off')
    localStorage.setItem('chess.ownerToken', FAKE)
    const { result } = renderHook(() => useOwnerToken())
    expect(result.current.enabled).toBe(false)
    expect(result.current.isSet).toBe(false)
  })
})
