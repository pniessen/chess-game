import { shortModelLabel, type ClaudeModelKey, type HeadToHead } from '../../claude/models'

const drawsText = (n: number): string => `${n} ${n === 1 ? 'draw' : 'draws'}`

/**
 * The head-to-head line: "Sonnet 5.5 2 – 1 Haiku 4.5 · 0 draws", the model
 * playing White now first. A mirror match reads by colour: "Haiku 4.5 vs
 * itself: White 1 – 0 Black · 2 draws". A dash while loading or unreadable.
 */
export function headToHeadText(
  record: HeadToHead | null | undefined,
  white: ClaudeModelKey,
  black: ClaudeModelKey,
): string {
  if (!record) return '—'
  if (white === black) {
    return `${shortModelLabel(white)} vs itself: White ${record.whiteWins} – ${record.blackWins} Black · ${drawsText(record.draws)}`
  }
  return `${shortModelLabel(white)} ${record.whiteModelWins} – ${record.blackModelWins} ${shortModelLabel(black)} · ${drawsText(record.draws)}`
}

/**
 * The Score card of a Claude vs Claude game: the two models' record over the
 * saved games instead of the human W–L–D (which Claude games never touch).
 * Only rendered behind CLAUDE_GAMES, so a public bundle has none of it.
 */
export function HeadToHeadCard({
  record,
  white,
  black,
}: {
  record: HeadToHead | null | undefined
  white: ClaudeModelKey
  black: ClaudeModelKey
}) {
  return (
    <div className="scoreboard head-to-head" data-testid="scoreboard">
      <span className="scoreboard-label">Head to head</span>
      <span className="scoreboard-value" data-testid="claude-record">
        {headToHeadText(record, white, black)}
      </span>
    </div>
  )
}
