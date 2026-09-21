import type { Settings } from '../../storage/storage'

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
