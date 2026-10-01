/**
 * The trial's own spending cap and ledger. Separate from the app's monthly
 * $20 ledger (~/.chess-game/claude-games), which the trial never reads or
 * writes: its ledger is `ledger.jsonl` in the trial's directory.
 */
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RESERVE_PER_GAME_USD, type ClaudeModelKey } from '../../src/claude/models'
import type { LedgerEntry } from './types'

/** Float slack, so a game that exactly fits is not refused by rounding. */
const EPS = 1e-9

/** What a game holds back when it starts: both seats' per-game reserves (sized to reach 160 plies). */
export const reserveFor = (white: ClaudeModelKey, black: ClaudeModelKey): number =>
  RESERVE_PER_GAME_USD[white] + RESERVE_PER_GAME_USD[black]

export interface Hold {
  reserveUsd: number
  spentUsd: number
}

/** Spent so far plus what the running games still hold (each its reserve less its own spend). */
export function committedUsd(spentUsd: number, holds: readonly Hold[]): number {
  return spentUsd + holds.reduce((sum, h) => sum + Math.max(0, h.reserveUsd - h.spentUsd), 0)
}

/** May a game holding `reserveUsd` start? */
export function canStart(spentUsd: number, holds: readonly Hold[], reserveUsd: number, capUsd: number): boolean {
  return committedUsd(spentUsd, holds) + reserveUsd <= capUsd + EPS
}

/** The hard cap, checked before every call: its worst-case charge must still fit. */
export function canCall(spentUsd: number, worstCallUsd: number, capUsd: number): boolean {
  return spentUsd + worstCallUsd <= capUsd + EPS
}

export const ledgerFile = (dir: string): string => join(dir, 'ledger.jsonl')

/** One line per charge, appended (a single small write, so a crash loses at most that line). */
export async function appendLedger(dir: string, entry: Omit<LedgerEntry, 't'>): Promise<void> {
  await appendFile(ledgerFile(dir), JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n')
}

/** The ledger re-read from disk: what a restart recomputes its spend from. Unreadable lines are skipped. */
export async function readLedger(dir: string): Promise<{
  file: string
  entries: LedgerEntry[]
  spentUsd: number
  moveUsd: number
  commentaryUsd: number
}> {
  const file = ledgerFile(dir)
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // No ledger yet: nothing spent.
  }
  const entries: LedgerEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as LedgerEntry
      if (typeof e.costUsd === 'number' && Number.isFinite(e.costUsd)) entries.push(e)
    } catch {
      // A torn line from a crash mid-write.
    }
  }
  const sum = (kind?: LedgerEntry['kind']) => entries.filter((e) => !kind || e.kind === kind).reduce((s, e) => s + e.costUsd, 0)
  return { file, entries, spentUsd: sum(), moveUsd: sum('move'), commentaryUsd: sum('commentary') }
}
