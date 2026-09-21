import { Position } from './position'
import { STARTING_FEN, type GameStatus, type MoveIntent, type MoveResult, type PlayedMove } from './types'

export class Game {
  readonly startFen: string
  private played: PlayedMove[] = []
  /** Moves taken back by undo(), available to redo(). Cleared on a new play. */
  private future: PlayedMove[] = []
  private viewPly: number

  constructor(opts?: { fen?: string }) {
    this.startFen = opts?.fen ?? STARTING_FEN
    this.viewPly = 0
  }

  get moves(): readonly PlayedMove[] {
    return this.played
  }

  get ply(): number {
    return this.viewPly
  }

  get livePly(): number {
    return this.played.length
  }

  isViewingLive(): boolean {
    return this.viewPly === this.played.length
  }

  /** Rebuild the position after `ply` moves by replaying from the start. */
  positionAt(ply: number): Position {
    const clamped = Math.max(0, Math.min(ply, this.played.length))
    const pos = new Position(this.startFen)
    for (let i = 0; i < clamped; i++) {
      const m = this.played[i]
      if (!m) break
      const r = pos.tryMove({ from: m.from, to: m.to, promotion: m.promotion })
      if (!r.ok) {
        throw new Error(`corrupt history: move ${i + 1} (${m.san}) is not legal`)
      }
    }
    return pos
  }

  current(): Position {
    return this.positionAt(this.viewPly)
  }

  play(intent: MoveIntent): MoveResult {
    if (!this.isViewingLive()) {
      // Refuse rather than discard. Call truncate() first to branch.
      return { ok: false, reason: 'illegal' }
    }
    const pos = this.positionAt(this.played.length)
    const result = pos.tryMove(intent)
    if (!result.ok) return result
    this.played.push(result.move)
    this.future = []
    this.viewPly = this.played.length
    return result
  }

  undo(): boolean {
    if (this.played.length === 0) return false
    const m = this.played.pop()
    if (m) this.future.push(m)
    this.viewPly = this.played.length
    return true
  }

  redo(): boolean {
    const m = this.future.pop()
    if (!m) return false
    this.played.push(m)
    this.viewPly = this.played.length
    return true
  }

  goTo(ply: number): void {
    this.viewPly = Math.max(0, Math.min(ply, this.played.length))
  }

  /** Discard every move after `ply`, making that the live position. */
  truncate(ply: number): void {
    const clamped = Math.max(0, Math.min(ply, this.played.length))
    this.played = this.played.slice(0, clamped)
    this.future = []
    this.viewPly = this.played.length
  }

  status(): GameStatus {
    return this.positionAt(this.played.length).status()
  }
}
