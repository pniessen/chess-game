import { useEffect, useState } from 'react'
import { fetchBudget } from '../../claude/gameClient'
import { getOwnerToken } from '../../claude/ownerToken'

/**
 * This month's Claude games budget left, for the New game panel: fetched each
 * time the Claude mode is selected. `undefined` while loading (or not asked
 * for), `null` when it could not be read.
 */
export function useClaudeBudget(active: boolean, fetchImpl?: typeof fetch): number | null | undefined {
  const [left, setLeft] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    if (!active) {
      setLeft(undefined)
      return
    }
    let live = true
    void fetchBudget({ ...(fetchImpl ? { fetch: fetchImpl } : {}), ownerToken: getOwnerToken }).then((v) => {
      if (live) setLeft(v)
    })
    return () => {
      live = false
    }
  }, [active, fetchImpl])

  return left
}
