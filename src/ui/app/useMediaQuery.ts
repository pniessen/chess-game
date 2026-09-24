import { useEffect, useState } from 'react'

/**
 * Task 6 (mobile pass): a single source of truth for "is the viewport
 * narrow enough that New game should collapse into a popover" — the same
 * question `App.tsx` needs answered to pick between rendering `NewGame`
 * inline (desktop, unchanged since Task 3) and wrapping it in the same
 * popover shell `GameFilePopover`/`SettingsPopover` already use (mobile).
 *
 * A CSS `@media` query alone cannot make that choice: the two render paths
 * mount DIFFERENT markup (a trigger + a conditionally-rendered dialog vs.
 * the form directly), not the same markup shown/hidden by CSS — and
 * rendering BOTH at once would duplicate every `data-testid` in `NewGame`
 * (`mode`, `level`, `new-game`, …), which is exactly what "every existing
 * `data-testid` ... unchanged" rules out (a duplicate breaks
 * `page.getByTestId` everywhere else that already assumes one match).
 *
 * `window.matchMedia`'s own `change` event (not a `resize` listener) is
 * what keeps this cheap: it only fires when the query's truth value
 * actually flips, not on every pixel of a drag-resize.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    // The query string itself can change between renders (it doesn't here,
    // but nothing pins that); re-sync on mount/re-subscribe rather than
    // trusting the initializer above to still be current.
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
