import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { useShareLink } from './useShareLink'

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('useShareLink', () => {
  test('no share param: none, already resolved, and resolve() is a harmless no-op', () => {
    window.history.pushState({}, '', '/')
    const { result } = renderHook(() => useShareLink())
    expect(result.current.pending).toEqual({ kind: 'none' })
    expect(result.current.resolved).toBe(true)
  })

  test('a valid share param: ok, and unresolved until resolve() is called', () => {
    window.history.pushState({}, '', '/?fen=rnbqkbnr%2Fpppppppp%2F8%2F8%2F8%2F8%2FPPPPPPPP%2FRNBQKBNR+w+KQkq+-+0+1')
    const { result } = renderHook(() => useShareLink())
    expect(result.current.pending.kind).toBe('ok')
    expect(result.current.resolved).toBe(false)
  })

  test('resolve() strips the query string from the URL so a reload does not repeat the offer', () => {
    window.history.pushState({}, '', '/?fen=abc')
    const { result } = renderHook(() => useShareLink())
    act(() => result.current.resolve())
    expect(result.current.resolved).toBe(true)
    expect(window.location.search).toBe('')
  })

  test('a malformed query never throws and is read as no share link', () => {
    window.history.pushState({}, '', '/?fen=');
    expect(() => renderHook(() => useShareLink())).not.toThrow()
  })
})
