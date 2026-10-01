/**
 * npm run trial -- --trial-id <id> [--models a,b,c] [--games-per-pair 4] [--cap-usd 40]
 *                  [--max-plies 160] [--concurrency 3] [--replay-unfinished] [--dry-run]
 *
 * A round robin between model seats, played headless through the same move
 * functions and routing as the local server (server/moveDispatch.ts), with
 * its own hard spending cap and ledger under ~/.chess-game/trials/<id>/.
 * It never reads or writes the app's monthly ledger. Resumable: run the same
 * command again and it skips the finished games. Progress: one line per move
 * and per game here and in <dir>/run.log, and <dir>/progress.json.
 *
 * Keys: ANTHROPIC_API_KEY from .env (npm run loads it), TypeSafe's from the
 * environment or ~/.config/typesafe/env, Gemini over Google ADC. None is ever
 * printed.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { CLAUDE_MODELS, isClaudeModelKey, RESERVE_PER_GAME_USD, type ClaudeModelKey } from '../../src/claude/models'
import { providerOf } from '../../src/claude/providers'
import { moveClientsFor } from '../../server/index'
import { dispatchMove } from '../../server/moveDispatch'
import { readLedger } from './budget'
import { estimateTrial, hours, PER_MOVE } from './estimate'
import { runTrial } from './runner'
import { buildSchedule } from './schedule'
import { EnginePool } from './stockfish'
import { trialDir, trialsRoot } from './store'

const ALL = Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]

function parse() {
  const { values } = parseArgs({
    options: {
      'trial-id': { type: 'string' },
      models: { type: 'string' },
      'games-per-pair': { type: 'string', default: '4' },
      'cap-usd': { type: 'string', default: '40' },
      'max-plies': { type: 'string', default: '160' },
      concurrency: { type: 'string', default: '3' },
      'replay-unfinished': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  })
  const num = (name: string, v: string | undefined, min: number, int = true) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) throw new Error(`--${name} must be ${int ? 'an integer' : 'a number'} >= ${min}`)
    return n
  }
  const models = (values.models ? values.models.split(',').map((s) => s.trim()).filter(Boolean) : ALL) as string[]
  for (const m of models) if (!isClaudeModelKey(m)) throw new Error(`unknown model ${JSON.stringify(m)}; the seats are ${ALL.join(', ')}`)
  const trialId = values['trial-id'] ?? (values['dry-run'] ? 'dry-run' : undefined)
  if (!trialId) throw new Error('--trial-id is required (e.g. --trial-id rr-2026-10-02)')
  return {
    trialId,
    models: models as ClaudeModelKey[],
    gamesPerPair: num('games-per-pair', values['games-per-pair'], 1),
    capUsd: num('cap-usd', values['cap-usd'], 0, false),
    maxPlies: num('max-plies', values['max-plies'], 1),
    concurrency: num('concurrency', values.concurrency, 1),
    replayUnfinished: values['replay-unfinished'] ?? false,
    dryRun: values['dry-run'] ?? false,
  }
}

function dryRun(o: ReturnType<typeof parse>): void {
  const schedule = buildSchedule(o.models, o.gamesPerPair)
  const e = estimateTrial(schedule, { maxPlies: o.maxPlies, concurrency: o.concurrency })
  console.log(`Dry run: ${schedule.length} games (${o.models.length} models, ${o.gamesPerPair} per pairing), cap $${o.capUsd}, ${o.maxPlies} max plies, concurrency ${o.concurrency}\n`)
  console.log('Schedule (in start order):')
  schedule.forEach((g, i) => console.log(`  ${String(i + 1).padStart(3)}. ${g.id.padEnd(28)} White ${g.white.padEnd(13)} Black ${g.black}`))
  console.log('\nPer-move numbers used (median s/move, opening move $; reserve per side per game):')
  for (const m of o.models) {
    const p = PER_MOVE[m]
    console.log(`  ${m.padEnd(13)} ${p.sec.toFixed(2).padStart(5)} s  $${p.openingUsd.toFixed(5)}  reserve $${RESERVE_PER_GAME_USD[m].toFixed(2)}  (${p.source})`)
  }
  console.log('\nEstimate:')
  for (const s of e.scenarios) console.log(`  ${s.label.padEnd(34)} cost ~$${s.costUsd.toFixed(2)}, wall ~${hours(s.wallSeconds)} at concurrency ${o.concurrency}`)
  console.log(`  largest single-game hold $${e.maxHoldUsd.toFixed(2)}; all games' reserves add up to $${e.reservesUsd.toFixed(2)} (the cap guard holds only running games')`)
  console.log('\nPer model (typical scenario):')
  for (const m of e.perModel) console.log(`  ${m.model.padEnd(13)} ${m.games} games  ~$${m.costUsd.toFixed(2)}`)
  console.log('\nTimes count model calls only; retries, timeouts (45 s each), rate-limit back-offs and Stockfish fallbacks add to them.')
}

async function main() {
  const o = parse()
  if (o.dryRun) return dryRun(o)

  const dir = trialDir(trialsRoot(), o.trialId)
  mkdirSync(dir, { recursive: true })
  const stamp = () => new Date().toISOString().slice(11, 19)
  const log = (line: string) => {
    const out = `${stamp()} ${line}`
    console.log(out)
    try {
      appendFileSync(join(dir, 'run.log'), out + '\n')
    } catch {
      // The console line is enough.
    }
  }

  const clients = moveClientsFor(process.env)
  // Refuse up front if a seat cannot be played (no key, or no working ADC), before anything is spent.
  const missing: string[] = []
  for (const m of o.models) {
    const p = providerOf(m)
    const up = p === 'anthropic' ? clients.client !== null : p === 'typesafe' ? clients.jev !== null : clients.vertex ? await clients.vertex.available() : false
    if (!up) missing.push(`${m} (${p === 'anthropic' ? 'no ANTHROPIC_API_KEY' : p === 'typesafe' ? 'no TYPESAFE_API_KEY' : 'no Google ADC'})`)
  }
  if (missing.length) throw new Error(`cannot seat: ${missing.join(', ')}`)

  const stop = { stopped: false }
  process.on('SIGINT', () => {
    if (stop.stopped) {
      log('second Ctrl-C: exiting now; running games are lost (their calls stay in the ledger) and replay on the next run')
      process.exit(130)
    }
    stop.stopped = true
    log('Ctrl-C: no new games; the running ones finish (Ctrl-C again to exit now)')
  })

  const before = (await readLedger(dir)).spentUsd
  const summary = await runTrial(
    { trialId: o.trialId, dir, models: o.models, gamesPerPair: o.gamesPerPair, capUsd: o.capUsd, maxPlies: o.maxPlies, concurrency: o.concurrency, replayUnfinished: o.replayUnfinished },
    {
      move: (req) => dispatchMove(clients, req),
      engines: new EnginePool(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log,
      stop,
    },
  )
  log(`this run spent $${(summary.spentUsd - before).toFixed(4)}; report: npm run trial:report -- --trial-id ${o.trialId}`)
  process.exit(summary.errors > 0 ? 1 : 0)
}

main().catch((err: unknown) => {
  // Fixed text only from our own errors; never a provider's raw error, which could echo a request.
  console.error(`trial: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
})
