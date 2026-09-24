import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useCoachClient } from './useCoachClient'

afterEach(() => vi.unstubAllEnvs())

test('VITE_COACH=off: no health check request, badge reads offline', async () => {
  vi.stubEnv('VITE_COACH', 'off')
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  const { result } = renderHook(() => useCoachClient())
  await waitFor(() => expect(result.current.coachState.status).toBe('offline'))

  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})

test('VITE_COACH unset: the client still probes the server as before', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))

  const { result } = renderHook(() => useCoachClient())
  await waitFor(() => expect(result.current.coachState.status).toBe('offline'))

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(fetchSpy).toHaveBeenCalledWith('/api/health', expect.anything())
  fetchSpy.mockRestore()
})

test('hint() and review() also skip the network when coaching is disabled', async () => {
  vi.stubEnv('VITE_COACH', 'off')
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  const { result } = renderHook(() => useCoachClient())
  await act(async () => {
    expect(await result.current.coach.hint({ fen: 'x', bestMoveSan: 'e4', line: ['e4'], evaluation: '+0.3' })).toBeNull()
    expect(
      await result.current.coach.review({
        moves: ['e4'],
        firstMover: 'w',
        result: '*',
        opening: null,
        accuracy: { w: null, b: null },
        flagged: [],
        humanSide: 'w',
      }),
    ).toBeNull()
  })

  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})
