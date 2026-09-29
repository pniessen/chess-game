import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import Anthropic from '@anthropic-ai/sdk'
import { MOVE_TIMEOUT_MS } from '../src/claude/models'
import { createClaude } from './claude'
import { randomBytes } from 'node:crypto'
import { fileStore } from './fileStore'

/**
 * The relay is unauthenticated and holds the Anthropic API key, so it must
 * only ever be reachable from this machine. Always bind loopback — never
 * read a HOST env var (common in shells/containers/CI, or loaded from a
 * .env file), which would silently expose the relay to the LAN and let
 * anyone on it spend the key.
 */
export const LISTEN_HOST = '127.0.0.1'

export function startServer(env: NodeJS.ProcessEnv = process.env): Promise<Server> {
  const port = Number(env['PORT'] ?? 8787)
  const apiKey = env['ANTHROPIC_API_KEY']?.trim() || null
  const gamesDir = fileURLToPath(new URL('../.claude-games', import.meta.url))
  const distDir = fileURLToPath(new URL('../dist', import.meta.url))

  const app = createApp({
    claude: apiKey ? createClaude({ apiKey }) : null,
    // `npm start` builds first; in dev, Vite serves the app and proxies /api here.
    // Local-only Claude games: the budget, lock and saved games persist under .claude-games/ (gitignored).
    // Tokens are HMACs under a secret that lives only as long as this process.
    games: {
      client: apiKey ? new Anthropic({ apiKey, timeout: MOVE_TIMEOUT_MS, maxRetries: 0 }) : null,
      store: fileStore(gamesDir),
      secret: randomBytes(32),
    },
    staticDir: existsSync(distDir) ? distDir : null,
  })

  return new Promise((resolve) => {
    const server = app.listen(port, LISTEN_HOST, () => {
      // Never log the key itself.
      console.log(
        `coach server on http://${LISTEN_HOST}:${port} — Claude ${apiKey ? 'enabled' : 'disabled (no ANTHROPIC_API_KEY)'}`,
      )
      resolve(server)
    })
  })
}

// Only start listening when this module is the program's entry point, not when a test imports it.
if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer()
}
