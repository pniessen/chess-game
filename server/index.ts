import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { createClaude } from './claude'

const port = Number(process.env['PORT'] ?? 8787)
const host = process.env['HOST'] ?? '127.0.0.1'
const apiKey = process.env['ANTHROPIC_API_KEY']?.trim() || null
const distDir = fileURLToPath(new URL('../dist', import.meta.url))

const app = createApp({
  claude: apiKey ? createClaude({ apiKey }) : null,
  // `npm start` builds first; in dev, Vite serves the app and proxies /api here.
  staticDir: existsSync(distDir) ? distDir : null,
})

app.listen(port, host, () => {
  // Never log the key itself.
  console.log(
    `coach server on http://${host}:${port} — Claude ${apiKey ? 'enabled' : 'disabled (no ANTHROPIC_API_KEY)'}`,
  )
})
