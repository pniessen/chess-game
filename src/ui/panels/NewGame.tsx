import { LEVELS } from '../../engine/strength'
import { TIME_CONTROLS } from '../../clock/types'
import type { Level } from '../../storage/storage'
import { CLAUDE_MODELS, type ClaudeModelKey } from '../../claude/models'
import { claudeEstimateUsd } from '../app/matchConfig'

export type Mode = 'two-player' | 'one-player' | 'zero-player' | 'claude-vs-claude'

/** Claude vs Claude's part of the panel; omitted on a build without coaching. */
export interface NewGameClaude {
  /** An owner token is stored: the mode is offered. */
  available: boolean
  white: ClaudeModelKey
  black: ClaudeModelKey
  onWhiteChange: (model: ClaudeModelKey) => void
  onBlackChange: (model: ClaudeModelKey) => void
  /** Dollars left this month; undefined while loading, null when unreadable. */
  budgetLeftUsd: number | null | undefined
}

const MODEL_KEYS = Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]

const usd = (n: number) => `$${n.toFixed(2)}`

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
  const isClaude = mode === 'claude-vs-claude'
  // Listed while a token is set — and while the panel is showing a Claude
  // game (a resumed one, the token since cleared), so the select never
  // names a value it has no option for.
  const offerClaude = claude !== undefined && (claude.available || isClaude)
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
            <option value="claude-vs-claude" disabled={!engineAvailable || !claude.available}>
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
        </div>
      ) : null}
      <div className="new-game-actions">
        <button data-testid="new-game" onClick={onStart}>
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
