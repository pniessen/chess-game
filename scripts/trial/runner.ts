/**
 * The trial's game pool: start games in schedule order, at most
 * `concurrency` at once and never two at once for the same model, each only
 * if the trial cap still covers both seats' reserves; save every finished
 * game atomically; and on a restart skip the finished ones and recompute the
 * spend from the trial's own ledger.
 */
import { join } from 'node:path'
import type { ClaudeModelKey } from '../../src/claude/models'
import { worstCaseCallUsd, type MissingKey, type MoveRequest } from '../../server/moveDispatch'
import type { MoveOutcome } from '../../server/claudeMove'
import { appendLedger, canCall, canStart, committedUsd, readLedger, reserveFor, type Hold } from './budget'
import { playGame } from './game'
import { buildSchedule, nextAction, type GameSpec } from './schedule'
import { ensureDirs, gameFile, loadGames, readJson, writeJsonAtomic } from './store'
import type { TrialEngine } from './stockfish'
import type { GameRecord, MoveRecord, TrialConfig } from './types'

export interface RunOptions {
  trialId: string
  /** The trial's directory (see ./store). */
  dir: string
  models: ClaudeModelKey[]
  gamesPerPair: number
  capUsd: number
  maxPlies: number
  concurrency: number
  /** Play again the saved games that ended with no result (model-unavailable). */
  replayUnfinished?: boolean
}

export interface RunDeps {
  move(req: MoveRequest): Promise<{ outcome: MoveOutcome } | { missing: MissingKey }>
  engines: { acquire(): Promise<TrialEngine>; release(e: TrialEngine): void }
  sleep(ms: number): Promise<void>
  log(line: string): void
  /** Set `stopped` (e.g. on Ctrl-C) to start no new games; running ones finish. */
  stop?: { stopped: boolean }
  onGameStart?(spec: GameSpec): void
  onGameEnd?(spec: GameSpec): void
}

export type RunState = 'done' | 'blocked-by-cap' | 'cap-reached' | 'stopped'

export interface RunSummary {
  state: RunState
  total: number
  /** Games finished in this run. */
  played: number
  /** Games already finished before this run. */
  skipped: number
  pending: number
  errors: number
  spentUsd: number
  /** The game the cap blocked, if it did. */
  blocked?: string
}

interface Running {
  spec: GameSpec
  hold: Hold
  plies: number
  done: Promise<void>
}

/** trial.json is written on the first run; a later run must ask for the same field. */
async function checkConfig(opts: RunOptions): Promise<void> {
  const file = join(opts.dir, 'trial.json')
  const old = await readJson<TrialConfig>(file)
  if (old) {
    const same =
      old.models.length === opts.models.length &&
      [...old.models].sort().join() === [...opts.models].sort().join() &&
      old.gamesPerPair === opts.gamesPerPair &&
      old.maxPlies === opts.maxPlies
    if (!same) {
      throw new Error(
        `trial ${opts.trialId} was started with models ${old.models.join(',')}, ${old.gamesPerPair} games per pair and ` +
          `${old.maxPlies} max plies (its trial.json); use those, or a new --trial-id`,
      )
    }
  }
  const config: TrialConfig = {
    v: 1,
    trialId: opts.trialId,
    createdAt: old?.createdAt ?? new Date().toISOString(),
    models: opts.models,
    gamesPerPair: opts.gamesPerPair,
    capUsd: opts.capUsd,
    maxPlies: opts.maxPlies,
    concurrency: opts.concurrency,
  }
  await writeJsonAtomic(file, config)
}

export async function runTrial(opts: RunOptions, deps: RunDeps): Promise<RunSummary> {
  await ensureDirs(opts.dir)
  await checkConfig(opts)
  const schedule = buildSchedule(opts.models, opts.gamesPerPair)
  const saved = await loadGames(opts.dir)
  const isDone = (g: GameRecord | undefined) => g !== undefined && !(opts.replayUnfinished && g.result === '*')
  const pending = schedule.filter((s) => !isDone(saved.get(s.id)))
  const skipped = schedule.length - pending.length
  let spent = (await readLedger(opts.dir)).spentUsd
  /** Worst cases of the calls in flight now, across all games: the hard cap counts them as spent. */
  let inFlight = 0
  const reserve = (s: GameSpec) => reserveFor(s.white, s.black, opts.maxPlies)
  const running = new Map<string, Running>()
  const busy = new Set<ClaudeModelKey>()
  let played = 0
  let errors = 0
  let capReached = false
  let blocked: GameSpec | undefined
  let state: RunState | 'running' = 'running'

  const holds = () => [...running.values()].map((r) => r.hold)
  const writeProgress = async () => {
    await writeJsonAtomic(join(opts.dir, 'progress.json'), {
      trialId: opts.trialId,
      state,
      updatedAt: new Date().toISOString(),
      capUsd: opts.capUsd,
      spentUsd: spent,
      committedUsd: committedUsd(spent, holds()),
      total: schedule.length,
      finished: skipped + played,
      pending: pending.length,
      running: [...running.values()].map((r) => ({
        id: r.spec.id,
        white: r.spec.white,
        black: r.spec.black,
        plies: r.plies,
        spentUsd: r.hold.spentUsd,
      })),
      ...(blocked ? { blockedBy: blocked.id } : {}),
    }).catch(() => {})
  }

  deps.log(
    `trial ${opts.trialId}: ${schedule.length} games, ${skipped} already finished, ${pending.length} to play; ` +
      `spent $${spent.toFixed(4)} of the $${opts.capUsd} cap; concurrency ${opts.concurrency}; dir ${opts.dir}`,
  )

  const launch = (spec: GameSpec) => {
    pending.splice(pending.indexOf(spec), 1)
    busy.add(spec.white)
    busy.add(spec.black)
    const hold: Hold = { reserveUsd: reserve(spec), spentUsd: 0 }
    let engine: TrialEngine | null = null
    let crashed = false
    const r: Running = { spec, hold, plies: 0, done: Promise.resolve() }
    running.set(spec.id, r)
    deps.onGameStart?.(spec)
    deps.log(`[${spec.id}] start: White ${spec.white}, Black ${spec.black} (holds $${hold.reserveUsd.toFixed(2)})`)
    r.done = (async () => {
      try {
        const record = await playGame(spec, {
          trialId: opts.trialId,
          maxPlies: opts.maxPlies,
          move: deps.move,
          engine: async () => (engine ??= await deps.engines.acquire()),
          charge: async (model, gameId, call) => {
            spent += call.costUsd
            hold.spentUsd += call.costUsd
            await appendLedger(opts.dir, {
              kind: 'move',
              model,
              gameId,
              outcome: call.kind,
              costUsd: call.costUsd,
              inputTokens: call.inputTokens,
              outputTokens: call.outputTokens,
              ms: call.ms,
            })
          },
          mayCall: (model) => {
            const worst = worstCaseCallUsd(model)
            if (!canCall(spent + inFlight, worst, opts.capUsd)) return null
            inFlight += worst
            let held = true
            return () => {
              if (held) inFlight -= worst
              held = false
            }
          },
          sleep: deps.sleep,
          log: deps.log,
          spentUsd: () => spent,
          onPly: (moves: readonly MoveRecord[]) => {
            r.plies = moves.length
            void writeProgress()
          },
        })
        if (record.termination === 'cap') {
          capReached = true
          await writeJsonAtomic(join(opts.dir, 'aborted', `${spec.id}-${Date.now()}.json`), record)
          pending.unshift(spec)
        } else {
          await writeJsonAtomic(gameFile(opts.dir, spec.id), record)
          played++
        }
      } catch (err) {
        crashed = true
        errors++
        const message = err instanceof Error ? err.message : String(err)
        deps.log(`[${spec.id}] crashed: ${message}; it stays pending for the next run`)
        await writeJsonAtomic(join(opts.dir, 'errors', `${spec.id}-${Date.now()}.json`), { gameId: spec.id, message }).catch(() => {})
      } finally {
        // A crashed game's engine may be the broken part: it is dropped, not reused.
        if (engine && !crashed) deps.engines.release(engine)
        running.delete(spec.id)
        busy.delete(spec.white)
        busy.delete(spec.black)
        deps.onGameEnd?.(spec)
        await writeProgress()
      }
    })()
  }

  await writeProgress()
  for (;;) {
    const stopping = capReached || deps.stop?.stopped
    if (!stopping && running.size < opts.concurrency) {
      // Games that crashed this run are not retried until the next run.
      const a = nextAction(pending, busy, running.size, (s) => canStart(spent, holds(), reserve(s), opts.capUsd))
      if (a.kind === 'start') {
        launch(a.spec)
        continue
      }
      if (a.kind === 'blocked') blocked = a.spec
    }
    if (running.size === 0) break
    await Promise.race([...running.values()].map((r) => r.done))
  }

  state = capReached ? 'cap-reached' : deps.stop?.stopped ? 'stopped' : blocked ? 'blocked-by-cap' : 'done'
  // Crashed games are still pending; say so rather than "done".
  spent = (await readLedger(opts.dir)).spentUsd
  await writeProgress()
  const summary: RunSummary = {
    state,
    total: schedule.length,
    played,
    skipped,
    pending: pending.length + errors,
    errors,
    spentUsd: spent,
    ...(blocked ? { blocked: blocked.id } : {}),
  }
  deps.log(
    `trial ${opts.trialId} ${state}: ${played} played now, ${skipped} before, ${summary.pending} pending` +
      `${errors ? `, ${errors} crashed` : ''}; spent $${spent.toFixed(4)} of $${opts.capUsd}` +
      `${blocked ? `; next game ${blocked.id} needs $${reserve(blocked).toFixed(2)} held and does not fit` : ''}`,
  )
  return summary
}
