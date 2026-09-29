import { useEffect, useState } from 'react'
import { fetchBudget, type ClaudeBudget } from '../../claude/gameClient'
import { CLAUDE_GAMES } from '../../claude/enabled'

/**
 * This month's Claude games budget left and usage per model, for the New game panel: fetched each
 * time the Claude mode is selected. `undefined` while loading (or not asked
 * for), `null` when it could not be read (the local server is not running or
 * has no key).
 */
export function useClaudeBudget(active: boolean, fetchImpl?: typeof fetch): ClaudeBudget | null | undefined {
  const [left, setLeft] = useState<ClaudeBudget | null | undefined>(undefined)

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
