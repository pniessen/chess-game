import { useCallback, useEffect, useState } from 'react'
import { getOwnerToken, setOwnerToken } from '../../claude/ownerToken'
import { coachEnabled } from './useCoachClient'

export interface OwnerTokenState {
  /** False on a build without a server (VITE_COACH=off, GitHub Pages): no field, no Claude mode. */
  enabled: boolean
  /** Whether a token is stored. The value itself is never handed to the UI. */
  isSet: boolean
  save: (value: string) => void
  clear: () => void
}

/**
 * The owner token as the UI sees it: set or not set, never its value. Kept in
 * React state so the New game panel offers (or withdraws) Claude vs Claude the
 * moment it is saved or cleared, with no reload; another tab's change arrives
 * through the `storage` event.
 */
export function useOwnerToken(): OwnerTokenState {
  const enabled = coachEnabled()
  const [isSet, setIsSet] = useState(() => getOwnerToken() !== null)

  useEffect(() => {
    const onStorage = () => setIsSet(getOwnerToken() !== null)
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = useCallback((value: string) => {
    const v = value.trim()
    if (!v) return
    setOwnerToken(v)
    setIsSet(getOwnerToken() !== null)
  }, [])

  const clear = useCallback(() => {
    setOwnerToken(null)
    setIsSet(false)
  }, [])

  return { enabled, isSet: enabled && isSet, save, clear }
}
