import type { ClaudeStartError } from './useClaudeSession'

/** Why a Claude vs Claude game could not start (or resume); nothing was started. */
export function claudeErrorText(kind: ClaudeStartError): string {
  switch (kind) {
    case 'busy':
      return 'Another Claude game is already running — try again when it ends.'
    case 'budget':
      return "This month's Claude games budget is used up — nothing was started."
    case 'forbidden':
      return 'The owner token was not accepted — check it in Settings.'
    case 'unavailable':
      return 'Claude is unavailable right now — nothing was started.'
  }
}
