/**
 * npm run trial:report -- --trial-id <id> [--depth 14] [--no-commentary]
 *
 * Analyses every saved game of a trial with Stockfish (cached), computes the
 * per-model numbers, asks Claude Opus 5.5 for 3-5 style bullets per model
 * (cached, charged to the trial ledger as "commentary"), and writes
 * report.md and report.json into the trial's directory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import { costUsd, estimateInputTokens, type ClaudeModelKey } from '../../src/claude/models'
import { OpeningBook } from '../../src/openings/book'
import { parseOpeningsData } from '../../src/openings/data'
import { ANALYSIS_DEPTH, analyzeAll } from './analyze'
import { canCall, readLedger } from './budget'
import { COMMENTARY_MAX_TOKENS, COMMENTARY_MODEL, commentaryCached, commentaryPrompt, excerptsFor, styleFacts, writeCommentary } from './commentary'
import { buildMarkdown } from './markdown'
import { computeStats } from './stats'
import { createEngine, type TrialEngine } from './stockfish'
import { ensureDirs, loadGames, readJson, trialDir, trialsRoot, writeJsonAtomic } from './store'
import type { TrialConfig } from './types'

async function main() {
  const { values } = parseArgs({
    options: {
      'trial-id': { type: 'string' },
      depth: { type: 'string', default: String(ANALYSIS_DEPTH) },
      'no-commentary': { type: 'boolean', default: false },
    },
    strict: true,
  })
  const id = values['trial-id']
  if (!id) throw new Error('--trial-id is required')
  const depth = Number(values.depth)
  if (!Number.isInteger(depth) || depth < 1 || depth > 30) throw new Error('--depth must be an integer from 1 to 30')
  const dir = trialDir(trialsRoot(), id)
  const config = await readJson<TrialConfig>(join(dir, 'trial.json'))
  if (!config) throw new Error(`no trial ${id} at ${dir}`)
  await ensureDirs(dir)
  const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`)

  const games = [...(await loadGames(dir)).values()]
  log(`trial ${id}: ${games.length} saved games; analysing at depth ${depth}`)
  let engine: TrialEngine | null = null
  const analyses = await analyzeAll(dir, games, async () => (engine ??= await createEngine()), { depth, log })

  const raw: unknown = JSON.parse(readFileSync(new URL('../../public/openings/openings.json', import.meta.url), 'utf8'))
  const data = parseOpeningsData(raw)
  const stats = computeStats(config.models, games, analyses, data ? new OpeningBook(data) : null)

  const commentary = new Map<ClaudeModelKey, string[]>()
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim()
  if (values['no-commentary']) {
    log('commentary: skipped (--no-commentary)')
  } else if (!apiKey) {
    log('commentary: skipped (no ANTHROPIC_API_KEY)')
  } else {
    const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 })
    for (const m of stats.perModel) {
      if (m.record.games + m.record.unfinished === 0) continue
      const prompt = commentaryPrompt(styleFacts(m, stats.field), excerptsFor(m, games, analyses))
      // The trial cap covers the commentary too: each call's worst case must still fit under it.
      const worst = costUsd(COMMENTARY_MODEL, {
        input_tokens: estimateInputTokens(prompt.system.length + prompt.user.length),
        output_tokens: COMMENTARY_MAX_TOKENS,
      })
      if (!(await commentaryCached(dir, m, prompt)) && !canCall((await readLedger(dir)).spentUsd, worst, config.capUsd)) {
        log(`commentary: ${m.model} skipped (its worst case $${worst.toFixed(3)} does not fit under the $${config.capUsd} trial cap)`)
        continue
      }
      try {
        const c = await writeCommentary(client, dir, m, prompt)
        commentary.set(m.model, c.bullets)
        log(`commentary: ${m.model} ${c.cached ? '(cached)' : `$${c.costUsd.toFixed(4)}`}, ${c.bullets.length} bullets`)
      } catch (err) {
        // The SDK's message carries no key; still, only its class name is shown.
        log(`commentary: ${m.model} failed (${err instanceof Error ? err.name : 'error'})`)
      }
    }
  }

  const ledger = await readLedger(dir)
  const generatedAt = new Date().toISOString()
  const md = buildMarkdown({ config, stats, games, ledger, depth, commentary, generatedAt })
  await writeJsonAtomic(join(dir, 'report.json'), {
    trialId: id,
    generatedAt,
    config,
    analysisDepth: depth,
    ledger: { spentUsd: ledger.spentUsd, moveUsd: ledger.moveUsd, commentaryUsd: ledger.commentaryUsd },
    stats,
    commentary: Object.fromEntries(commentary),
    games: games.map((g) => ({ id: g.gameId, white: g.white, black: g.black, result: g.result, termination: g.termination, plies: g.plies })),
  })
  const { writeFile, rename } = await import('node:fs/promises')
  const mdFile = join(dir, 'report.md')
  await writeFile(`${mdFile}.tmp`, md)
  await rename(`${mdFile}.tmp`, mdFile)
  log(`wrote ${mdFile} and report.json`)
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(`trial:report: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
})
