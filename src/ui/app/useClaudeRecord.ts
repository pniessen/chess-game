import { useEffect, useState } from 'react'
import { fetchRecord } from '../../claude/gameClient'
import { CLAUDE_GAMES } from '../../claude/enabled'
import type { ClaudeModelKey, HeadToHead } from '../../claude/models'

/**
 * The head-to-head record of the two models on the board, for the Score card
 * of a Claude game. Fetched when the pairing is set and again whenever
 * `refreshKey` moves (the session's `endsSettled`: a game's saved record is
 * written by the time its end has landed). `undefined` while the first load
 * for a pairing is in flight (a refresh keeps the last record), `null` when it
 * could not be read.
 */
export function useClaudeRecord(
  pair: { white: ClaudeModelKey; black: ClaudeModelKey } | null,
  refreshKey: number,
  fetchImpl?: typeof fetch,
): HeadToHead | null | undefined {
  const [state, setState] = useState<{ pairKey: string; record: HeadToHead | null | undefined }>({
    pairKey: '',
    record: undefined,
  })
  const white = pair?.white ?? null
  const black = pair?.black ?? null
  const pairKey = white && black ? `${white}/${black}` : ''

  useEffect(() => {
    // CLAUDE_GAMES first: a public build drops the fetch (and its URL) from the bundle.
    if (!CLAUDE_GAMES || !white || !black) return
    let live = true
    const key = `${white}/${black}`
    void fetchRecord(white, black, fetchImpl ? { fetch: fetchImpl } : {}).then((record) => {
      if (live) setState({ pairKey: key, record })
    })
    return () => {
      live = false
    }
  }, [white, black, refreshKey, fetchImpl])

  // A record fetched for another pairing is not this one's: loading until its own lands.
  return pairKey && state.pairKey === pairKey ? state.record : undefined
}
