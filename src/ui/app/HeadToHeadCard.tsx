import { Fragment } from 'react'
import { shortModelLabel, type ClaudeModelKey, type HeadToHead } from '../../claude/models'

const drawsText = (n: number): string => `${n} ${n === 1 ? 'draw' : 'draws'}`

/**
 * The head-to-head line in the pieces it may wrap between (never inside a
 * model's name): "Sonnet 5.5 2 –" "1 Haiku 4.5" "· 0 draws", the model
 * playing White now first. A mirror match reads by colour: "Haiku 4.5 vs
 * itself:" "White 1 – 0 Black" "· 2 draws". A dash while loading or unreadable.
 */
function headToHeadParts(
  record: HeadToHead | null | undefined,
  white: ClaudeModelKey,
  black: ClaudeModelKey,
): string[] {
  if (!record) return ['—']
  const draws = `· ${drawsText(record.draws)}`
  if (white === black) {
    return [`${shortModelLabel(white)} vs itself:`, `White ${record.whiteWins} – ${record.blackWins} Black`, draws]
  }
  return [`${shortModelLabel(white)} ${record.whiteModelWins} –`, `${record.blackModelWins} ${shortModelLabel(black)}`, draws]
}

/** The head-to-head line as one string, e.g. "Sonnet 5.5 2 – 1 Haiku 4.5 · 0 draws". */
export function headToHeadText(
  record: HeadToHead | null | undefined,
  white: ClaudeModelKey,
  black: ClaudeModelKey,
): string {
  return headToHeadParts(record, white, black).join(' ')
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
        {headToHeadParts(record, white, black).map((part, i) => (
          // The space between pieces sits outside them: it is where the line may break.
          <Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span className="head-to-head-part">{part}</span>
          </Fragment>
        ))}
      </span>
    </div>
  )
}
