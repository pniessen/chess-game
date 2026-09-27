import { fireEvent, screen } from '@testing-library/react'

/**
 * Shared helpers for the unit tests that drive a rendered `<App />`.
 *
 * Not a test file (the Vitest `include` glob is `*.test.{ts,tsx}`) and
 * never imported by the app, so it is neither collected as a suite nor
 * bundled — it sits beside `src/test-setup.ts` in kind.
 *
 * The e2e side has `tests/e2e/helpers.ts`; this is its twin, and exists
 * for the same reason: Task 4 put Export/Share/Import behind a popover,
 * and without one place to say how to open it the same six lines get
 * copied into every file that imports a fixture position.
 */

/**
 * Paste a PGN or single-line FEN into the `Game file` popover and import it.
 *
 * A SUCCESSFUL import closes the popover again and returns focus to the
 * trigger, so `queryByTestId('game-file')` being null is the success
 * signal; a FAILED one leaves it open with `import-error` filled in.
 */
export function importGame(text: string): void {
  fireEvent.click(screen.getByTestId('game-file-toggle'))
  fireEvent.change(screen.getByTestId('import-text'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('import-submit'))
}

/** Open the `Game file` popover and leave it open. */
export function openGameFile(): HTMLElement {
  fireEvent.click(screen.getByTestId('game-file-toggle'))
  return screen.getByTestId('game-file')
}
