import { LEVELS } from '../../engine/strength'
import { TIME_CONTROLS } from '../../clock/types'
import type { Level } from '../../storage/storage'

export type Mode = 'two-player' | 'one-player' | 'zero-player'

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
}) {
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
        </select>
      </label>
      <label>
        Level
        <select
          data-testid="level"
          value={level}
          disabled={mode === 'two-player'}
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
          onChange={(e) => onTimeControlChange(e.target.value)}
        >
          {TIME_CONTROLS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <button data-testid="new-game" onClick={onStart}>
        New game
      </button>
    </div>
  )
}
