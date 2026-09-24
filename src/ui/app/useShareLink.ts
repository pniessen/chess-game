import { useCallback, useState } from 'react'
import { parseShareLink, type ShareParseResult } from '../share'

export interface ShareLinkState {
  /** Parsed once, from the URL this page loaded with. */
  pending: ShareParseResult
  /** False until the share link has been acted on (loaded, declined, or its error dismissed). */
  resolved: boolean
  /**
   * Marks the share link resolved and strips it from the URL, so a reload
   * doesn't repeat the offer or reload the same position a second time.
   * Never touches anything in storage — see App.tsx's wiring, which is what
   * keeps a resumable saved game intact.
   */
  resolve: () => void
}

/**
 * Task 14: reads a shared-position link (see ../share.ts) off the page's
 * own URL, once, at startup. Parsing happens in a `useState` initializer —
 * exactly like `useMatchRecords`'s `pendingResume` — so it reflects the URL
 * this page load actually had, not one that may have already been stripped
 * by an earlier `resolve()` (e.g. under React Strict Mode's double-invoke).
 */
export function useShareLink(): ShareLinkState {
  const [pending] = useState<ShareParseResult>(() => {
    try {
      return parseShareLink(window.location.search)
    } catch {
      return { kind: 'none' }
    }
  })
  const [resolved, setResolved] = useState(pending.kind === 'none')

  const resolve = useCallback(() => {
    setResolved(true)
    try {
      const url = new URL(window.location.href)
      url.search = ''
      window.history.replaceState(window.history.state, '', url)
    } catch {
      // A non-browser test host, or a locked-down history API: losing the
      // cosmetic URL cleanup is fine, re-parsing the game is not attempted.
    }
  }, [])

  return { pending, resolved, resolve }
}
