import type { Settings } from '../../storage/storage'
import { BOARD_THEMES } from '../themes'
import { PIECE_SETS } from '../pieceSets'

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}) {
  return (
    <fieldset className="settings" data-testid="settings">
      <legend>Settings</legend>
      <label>
        Board
        <select
          data-testid="board-theme"
          value={settings.themeId}
          onChange={(e) => onChange({ themeId: e.target.value })}
        >
          {BOARD_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Pieces
        <select
          data-testid="piece-set"
          value={settings.pieceSetId}
          onChange={(e) => onChange({ pieceSetId: e.target.value })}
        >
          {PIECE_SETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="sound-toggle"
          checked={settings.soundEnabled}
          onChange={(e) => onChange({ soundEnabled: e.target.checked })}
        />
        Sound
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="eval-toggle"
          checked={settings.showEval}
          onChange={(e) => onChange({ showEval: e.target.checked })}
        />
        Evaluation bar
      </label>
    </fieldset>
  )
}
