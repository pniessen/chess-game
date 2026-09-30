import { LEVELS } from '../../engine/strength'
import { TIME_CONTROLS } from '../../clock/types'
import type { Level } from '../../storage/storage'
import { CLAUDE_MODELS, shortModelLabel, type ClaudeModelKey, type UsageByModel } from '../../claude/models'
import { claudeEstimateUsd } from '../app/matchConfig'
import { CLAUDE_GAMES } from '../../claude/enabled'

export type Mode = 'two-player' | 'one-player' | 'zero-player' | 'claude-vs-claude'

/**
 * Claude vs Claude's part of the panel; omitted on a build without the flag
 * (see claude/enabled.ts), which offers no such mode.
 */
export interface NewGameClaude {
  white: ClaudeModelKey
  black: ClaudeModelKey
  onWhiteChange: (model: ClaudeModelKey) => void
  onBlackChange: (model: ClaudeModelKey) => void
  /**
   * Dollars left this month; undefined while loading, null when unreadable —
   * the local server is not running or has no key, so Start is disabled.
   */
  budgetLeftUsd: number | null | undefined
  /** This month's usage per model and the dollars from before it was tracked; absent until read. */
  month?: { byModel: UsageByModel; earlierUsd: number }
}

const MODEL_KEYS = Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]

const usd = (n: number) => `$${n.toFixed(2)}`

/** Calls, not moves: a retried or timed-out request is a call too. */
const CALL_NOTE = 'A call is one request to the model, retries included.'

/** "Fable" from "Claude Fable 5.1": the month line is kept short. */
const familyLabel = (k: ClaudeModelKey) => shortModelLabel(k).replace(/ [\d.]+$/, '')

/**
 * "This month: Fable $0.23 (12 calls, 3.9 s/call) · … · Earlier: $0.13", for
 * the models with calls; output tokens only in each model's title. Null when
 * there is nothing to show.
 */
function MonthLine({ month }: { month: NonNullable<NewGameClaude['month']> }) {
  const parts = MODEL_KEYS.flatMap((k) => {
    const u = month.byModel[k]
    if (!u || u.calls <= 0) return []
    const perCall = (u.ms / u.calls / 1000).toFixed(1)
    return [
      <span key={k} title={`${shortModelLabel(k)}: ${u.outputTokens.toLocaleString('en-US')} output tokens. ${CALL_NOTE}`}>
        {`${familyLabel(k)} ${usd(u.costUsd)} (${u.calls} ${u.calls === 1 ? 'call' : 'calls'}, ${perCall} s/call)`}
      </span>,
    ]
  })
  if (month.earlierUsd > 0.005) parts.push(<span key="earlier">{`Earlier: ${usd(month.earlierUsd)}`}</span>)
  if (parts.length === 0) return null
  return (
    <p className="claude-note" data-testid="claude-month">
      This month:{' '}
      {parts.flatMap((p, i) => (i === 0 ? [p] : [' · ', p]))}
    </p>
  )
}

export function NewGame({
  mode,
  level,
  timeControlId,
  color,
  engineAvailable,
  onModeChange,
  onLevelChange,
  onTimeControlChange,
  onColorChange,
  onStart,
  onPuzzles,
  claude,
}: {
  mode: Mode
  level: Level
  timeControlId: string
  color: 'white' | 'black'
  engineAvailable: boolean
  onModeChange: (mode: Mode) => void
  onLevelChange: (level: Level) => void
  onTimeControlChange: (id: string) => void
  onColorChange: (color: 'white' | 'black') => void
  onStart: () => void
  onPuzzles?: () => void
  claude?: NewGameClaude
}) {
  // Every Claude branch starts with CLAUDE_GAMES, a build-time constant: in a
  // public build it is `false`, so the minifier drops the option, the model
  // selects and the hint (and the mode's name with them) from the bundle.
  const isClaude = CLAUDE_GAMES && mode === 'claude-vs-claude'
  const offerClaude = CLAUDE_GAMES && claude !== undefined
  // The budget request failed: the local server is not running or has no key.
  const claudeUnavailable = isClaude && claude !== undefined && claude.budgetLeftUsd === null
  return (
    <div className="new-game">
      <label>
        Mode
        <select
          data-testid="mode"
          value={mode}
          onChange={(e) => onModeChange(e.target.value as Mode)}
        >
          <option value="two-player">Two players</option>
          <option value="one-player" disabled={!engineAvailable}>
            One player
          </option>
          <option value="zero-player" disabled={!engineAvailable}>
            Engine vs engine
          </option>
          {offerClaude ? (
            // Needs the engine too: a failed Claude reply falls back to Stockfish.
            <option value="claude-vs-claude" disabled={!engineAvailable}>
              Claude vs Claude
            </option>
          ) : null}
        </select>
      </label>
      <label>
        Level
        <select
          data-testid="level"
          value={level}
          disabled={mode === 'two-player' || isClaude}
          onChange={(e) => onLevelChange(Number(e.target.value) as Level)}
        >
          {LEVELS.map((p) => (
            <option key={p.level} value={p.level}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Play as
        <select
          data-testid="color"
          value={color}
          disabled={mode !== 'one-player'}
          onChange={(e) => onColorChange(e.target.value as 'white' | 'black')}
        >
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
      </label>
      <label>
        Time control
        <select
          data-testid="time-control"
          value={timeControlId}
          disabled={isClaude}
          onChange={(e) => onTimeControlChange(e.target.value)}
        >
          {TIME_CONTROLS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {isClaude && claude ? (
        <div className="claude-setup">
          <label>
            White
            <select
              data-testid="claude-white"
              value={claude.white}
              onChange={(e) => claude.onWhiteChange(e.target.value as ClaudeModelKey)}
            >
              {MODEL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CLAUDE_MODELS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Black
            <select
              data-testid="claude-black"
              value={claude.black}
              onChange={(e) => claude.onBlackChange(e.target.value as ClaudeModelKey)}
            >
              {MODEL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CLAUDE_MODELS[k].label}
                </option>
              ))}
            </select>
          </label>
          <p className="claude-note" data-testid="claude-estimate">
            Estimated cost: {usd(claudeEstimateUsd(claude.white, claude.black))}
          </p>
          <p className="claude-note" data-testid="claude-budget">
            Budget left this month:{' '}
            {claude.budgetLeftUsd === undefined
              ? '…'
              : claude.budgetLeftUsd === null
                ? 'unavailable'
                : usd(claude.budgetLeftUsd)}
          </p>
          {claude.month && typeof claude.budgetLeftUsd === 'number' ? <MonthLine month={claude.month} /> : null}
          {claudeUnavailable ? (
            <p className="claude-note" role="status" data-testid="claude-unavailable-hint">
              Claude games are unavailable. Start the local server (npm run server) with ANTHROPIC_API_KEY in .env.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="new-game-actions">
        <button data-testid="new-game" disabled={claudeUnavailable} onClick={onStart}>
          New game
        </button>
        {onPuzzles ? (
          <button data-testid="open-puzzles" onClick={onPuzzles}>
            Puzzles
          </button>
        ) : null}
      </div>
    </div>
  )
}
