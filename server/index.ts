import { existsSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import Anthropic from '@anthropic-ai/sdk'
import { MOVE_TIMEOUT_MS } from '../src/claude/models'
import { createClaude } from './claude'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileStore } from './fileStore'
import { createJevClient } from './jevMove'
import { DEFAULT_GCP_PROJECT, VERTEX_LOCATION, createVertexClient, type VertexClient } from './geminiMove'

/**
 * The relay is unauthenticated and holds the Anthropic API key, so it must
 * only ever be reachable from this machine. Always bind loopback — never
 * read a HOST env var (common in shells/containers/CI, or loaded from a
 * .env file), which would silently expose the relay to the LAN and let
 * anyone on it spend the key.
 */
export const LISTEN_HOST = '127.0.0.1'

/**
 * Where the Claude games ledger (the month's spend, the one-game lock, saved
 * games) lives: `CLAUDE_GAMES_DIR` if set, else `~/.chess-game/claude-games`.
 * Outside the checkout on purpose, so every worktree shares one $20 cap.
 */
export function gamesDirFor(env: NodeJS.ProcessEnv, home: string = homedir()): string {
  return env['CLAUDE_GAMES_DIR']?.trim() || join(home, '.chess-game', 'claude-games')
}

/** Where the TypeSafe key is kept: `TYPESAFE_ENV_FILE` if set, else `~/.config/typesafe/env`. */
export function typesafeEnvFileFor(env: NodeJS.ProcessEnv, home: string = homedir()): string {
  return env['TYPESAFE_ENV_FILE']?.trim() || join(home, '.config', 'typesafe', 'env')
}

/**
 * The TypeSafe API key for Jev seats: `TYPESAFE_API_KEY` from the
 * environment (a sourced shell, or `.env` through `npm run server`'s
 * --env-file-if-exists), else that variable's line in `file` (a shell file
 * of `export TYPESAFE_API_KEY=...`, quotes optional). Null when neither has
 * one. The value is only ever handed to createJevClient: never logged.
 */
export function typesafeKeyFor(env: NodeJS.ProcessEnv, file: string): string | null {
  const fromEnv = env['TYPESAFE_API_KEY']?.trim()
  if (fromEnv) return fromEnv
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  // Like a shell: the last assignment wins; a quoted value is taken whole, an unquoted one ends
  // at whitespace (so at a ` # comment`). No `$VAR` expansion.
  const lines = [...text.matchAll(/^[ \t]*(?:export[ \t]+)?TYPESAFE_API_KEY[ \t]*=(.*)$/gm)]
  const raw = (lines.at(-1)?.[1] ?? '').trim()
  const quoted = /^(['"])(.*?)\1/.exec(raw)
  const value = quoted ? quoted[2]! : (raw.split(/\s/)[0] ?? '')
  return value.trim() || null
}

/** The Google Cloud project Gemini seats bill to: `GOOGLE_CLOUD_PROJECT` if set, else the owner's default. */
export function gcpProjectFor(env: NodeJS.ProcessEnv): string {
  return env['GOOGLE_CLOUD_PROJECT']?.trim() || DEFAULT_GCP_PROJECT
}

/** How long the startup line waits on the ADC check before calling Gemini disabled (the budget asks again later). */
const ADC_CHECK_MS = 10_000

/**
 * `opts.vertex` replaces the Vertex AI client (tests pass null or a fake, so
 * they never use the owner's real Google credentials). By default one is built
 * over Application Default Credentials; it seats Gemini only while they work.
 */
export function startServer(env: NodeJS.ProcessEnv = process.env, opts: { vertex?: VertexClient | null } = {}): Promise<Server> {
  const port = Number(env['PORT'] ?? 8787)
  const apiKey = env['ANTHROPIC_API_KEY']?.trim() || null
  const typesafeKey = typesafeKeyFor(env, typesafeEnvFileFor(env))
  const gamesDir = gamesDirFor(env)
  const distDir = fileURLToPath(new URL('../dist', import.meta.url))
  const gcpProject = gcpProjectFor(env)
  const vertex = opts.vertex !== undefined ? opts.vertex : createVertexClient({ project: gcpProject })

  const app = createApp({
    claude: apiKey ? createClaude({ apiKey }) : null,
    // `npm start` builds first; in dev, Vite serves the app and proxies /api here.
    // Local-only Claude games: the budget, lock and saved games persist under gamesDir (see gamesDirFor).
    // Tokens are HMACs under a secret that lives only as long as this process; the boot id
    // marks the games lock as this process's, so after a restart a stale lock is settled at once.
    games: {
      client: apiKey ? new Anthropic({ apiKey, timeout: MOVE_TIMEOUT_MS, maxRetries: 0 }) : null,
      // Jev seats (TypeSafe); without a key the budget leaves `jev` out of its models and start refuses it.
      jev: typesafeKey ? createJevClient({ apiKey: typesafeKey }) : null,
      // Gemini seats (Vertex AI, ADC); without working ADC the budget leaves them out and start refuses them.
      vertex,
      store: fileStore(gamesDir),
      secret: randomBytes(32),
      boot: randomUUID(),
    },
    staticDir: existsSync(distDir) ? distDir : null,
  })

  return new Promise((resolve) => {
    const server = app.listen(port, LISTEN_HOST, async () => {
      const adc = vertex
        ? await Promise.race([vertex.available(), new Promise<boolean>((r) => setTimeout(() => r(false), ADC_CHECK_MS).unref())])
        : false
      // Never log either key itself, nor anything from Google's credentials.
      console.log(
        `coach server on http://${LISTEN_HOST}:${port} — Claude ${apiKey ? 'enabled' : 'disabled (no ANTHROPIC_API_KEY)'}, ` +
          `Jev ${typesafeKey ? 'enabled' : 'disabled (no TYPESAFE_API_KEY)'}, ` +
          `Gemini ${adc ? `enabled (Vertex AI, project ${gcpProject}, ${VERTEX_LOCATION})` : 'disabled (no Google Application Default Credentials)'}`,
      )
      resolve(server)
    })
  })
}

// Only start listening when this module is the program's entry point, not when a test imports it.
if (import.meta.url === `file://${process.argv[1]}`) {
  void startServer()
}
