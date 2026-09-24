import { useEffect } from 'react'
import type { Appearance } from '../../storage/storage'

/**
 * Task 12: light / dark / system.
 *
 * app.css already keys its dark palette off BOTH the host's
 * `prefers-color-scheme` and an explicit `data-theme` on the root element
 * (`:root:not([data-theme='light'])` / `:root[data-theme='dark']`), so
 * forcing a palette is exactly a matter of setting — or, for 'system',
 * removing — that one attribute. Nothing else in the app changes.
 */
export function useAppearance(appearance: Appearance): void {
  useEffect(() => {
    const root = document.documentElement
    if (appearance === 'system') {
      root.removeAttribute('data-theme')
      return
    }
    root.setAttribute('data-theme', appearance)
  }, [appearance])
}
