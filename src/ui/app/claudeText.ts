import type { ClaudeStartError } from './useClaudeSession'

/** Why a Claude vs Claude game could not start (or resume); nothing was started. */
export function claudeErrorText(kind: ClaudeStartError): string {
  switch (kind) {
    case 'busy':
      return 'Another Claude game is already running — try again when it ends.'
    case 'budget':
      return "This month's Claude games budget is used up — nothing was started."
    case 'forbidden':
      // The local server's loopback Origin check: this page is not on localhost.
      return 'The local server refused this page — open the app on localhost. Nothing was started.'
    case 'unavailable':
      return 'Claude is unavailable — start the local server (npm run server) with ANTHROPIC_API_KEY in .env. Nothing was started.'
    case 'no-jev-key':
      return 'Jev is unavailable — the local server has no TYPESAFE_API_KEY (see README). Nothing was started.'
    case 'no-gemini-auth':
      return 'Gemini is unavailable — the local server has no Google Application Default Credentials (run gcloud auth application-default login; see README). Nothing was started.'
  }
}
