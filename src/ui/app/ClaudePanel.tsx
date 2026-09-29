import { useEffect, useState } from 'react'
import { CLAUDE_MODELS } from '../../claude/models'
import type { ClaudeNote, MatchConfig, MatchPhase } from '../../match/types'
import { FALLBACK_TITLE } from '../panels/MoveList'

/** The Claude model thinking right now, or null (someone else's turn, paused, over). */
function thinkingLabel(phase: MatchPhase, config: MatchConfig): string | null {
  if (phase.kind !== 'engine-thinking') return null
  const seat = phase.side === 'w' ? config.white : config.black
  return seat.kind === 'claude' ? CLAUDE_MODELS[seat.model].label : null
}

/**
 * Claude vs Claude's live line, under the clocks: who is thinking and for
 * how long, and what the game has cost so far. Both lines always render in
 * a Claude game (the thinking one empty when nobody is), so nothing below
 * them moves as turns come and go.
 */
export function ClaudeStatus({
  phase,
  config,
  spentUsd,
}: {
  phase: MatchPhase
  config: MatchConfig
  /** The server's running total for this game, in dollars. */
  spentUsd: number
}) {
  const label = thinkingLabel(phase, config)
  // Each ask is its own count: the request id changes with every turn.
  const turnKey = label !== null && phase.kind === 'engine-thinking' ? phase.requestId : null
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    setSeconds(0)
    if (turnKey === null) return
    const started = Date.now()
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [turnKey])

  return (
    <div className="claude-status">
      <p className="claude-thinking" data-testid="claude-thinking" aria-live="off">
        {label !== null ? `${label} is thinking… ${seconds}s` : ''}
      </p>
      <p className="claude-cost" data-testid="claude-cost">
        This game: ${spentUsd.toFixed(2)}
      </p>
    </div>
  )
}

/**
 * The rationale under the board for the displayed ply: the note of the move
 * that led to it. A fixed-height line in a Claude game, so a long reason or
 * an empty one never moves anything.
 */
export function ClaudeWhy({ notes, ply }: { notes: Readonly<Record<number, ClaudeNote>>; ply: number }) {
  const note = ply > 0 ? notes[ply - 1] : undefined
  const text = note ? (note.fallback ? `⚙ ${FALLBACK_TITLE}` : note.why) : ''
  return (
    <p className="claude-why" data-testid="claude-why" title={text || undefined}>
      {text}
    </p>
  )
}
