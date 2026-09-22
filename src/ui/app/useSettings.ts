import { useCallback, useState } from 'react'
import { loadSettings, saveSettings, type Settings } from '../../storage/storage'

/** The persisted settings, and a patch-updater that saves on every change. */
export function useSettings(): { settings: Settings; updateSettings: (patch: Partial<Settings>) => void } {
  const [settings, setSettings] = useState(() => loadSettings())
  // Every settings change is persisted immediately. (Phase 1 kept a frozen
  // copy and re-saved it on New game, which would silently undo any other
  // setting changed since the page loaded.)
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
  return { settings, updateSettings }
}
