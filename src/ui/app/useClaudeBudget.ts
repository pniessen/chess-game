import { useEffect, useState } from 'react'
import { fetchBudget } from '../../claude/gameClient'
import { CLAUDE_GAMES } from '../../claude/enabled'

/**
 * This month's Claude games budget left, for the New game panel: fetched each
 * time the Claude mode is selected. `undefined` while loading (or not asked
 * for), `null` when it could not be read (the local server is not running or
 * has no key).
 */
export function useClaudeBudget(active: boolean, fetchImpl?: typeof fetch): number | null | undefined {
  const [left, setLeft] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    // CLAUDE_GAMES first: a public build drops the fetch (and its URL) from the bundle.
    if (!CLAUDE_GAMES || !active) {
      setLeft(undefined)
      return
    }
    let live = true
    void fetchBudget(fetchImpl ? { fetch: fetchImpl } : {}).then((v) => {
      if (live) setLeft(v)
    })
    return () => {
      live = false
    }
  }, [active, fetchImpl])

  return left
}
