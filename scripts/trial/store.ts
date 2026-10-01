/**
 * Where a trial lives on disk, and atomic writes. A trial is a directory,
 * `~/.chess-game/trials/<trial-id>/` by default (`CHESS_TRIALS_DIR` overrides
 * the parent), next to but never inside the app's `claude-games` ledger:
 *
 *   trial.json      the settings it was started with
 *   ledger.jsonl    every charged call (and the report's commentary calls)
 *   progress.json   a running snapshot, rewritten after every move
 *   games/<id>.json one finished game: PGN, and per move its model, ms, tokens, cost, fallback flag and "why"
 *   aborted/        games stopped by the hard cap (replayed on the next run)
 *   errors/         games that crashed (replayed on the next run)
 *   analysis/       the report's Stockfish cache, commentary/ its Claude cache
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { GameRecord } from './types'

export function trialsRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env['CHESS_TRIALS_DIR']?.trim() || join(home, '.chess-game', 'trials')
}

/** A trial id is a directory name: letters, digits, dot, dash and underscore. */
export function isTrialId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) && !id.includes('..')
}

export const trialDir = (root: string, id: string): string => {
  if (!isTrialId(id)) throw new Error(`not a usable trial id: ${JSON.stringify(id)}`)
  return join(root, id)
}

/** Write via a temporary file and a rename, so a reader (or a crash) never sees half a file. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n')
  await rename(tmp, file)
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export async function ensureDirs(dir: string): Promise<void> {
  for (const sub of ['games', 'aborted', 'errors', 'analysis', 'commentary']) await mkdir(join(dir, sub), { recursive: true })
}

/** Every saved game, by id. Unreadable files (and temp files) are skipped. */
export async function loadGames(dir: string): Promise<Map<string, GameRecord>> {
  const out = new Map<string, GameRecord>()
  let names: string[] = []
  try {
    names = await readdir(join(dir, 'games'))
  } catch {
    return out
  }
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    const g = await readJson<GameRecord>(join(dir, 'games', name))
    if (g && g.v === 1 && typeof g.gameId === 'string' && Array.isArray(g.moves)) out.set(g.gameId, g)
  }
  return out
}

export const gameFile = (dir: string, id: string): string => join(dir, 'games', `${id}.json`)
