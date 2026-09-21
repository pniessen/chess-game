import type { ClockState, TimeControl } from './types'

type Side = 'w' | 'b'

export class Clock {
  private readonly control: TimeControl
  private readonly now: () => number
  private remaining: Record<Side, number>
  private running: Side | null = null
  private startedAt = 0
  private flagged: Side | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private flagCallbacks: Array<(side: Side) => void> = []
  private pausedSide: Side | null = null

  constructor(control: TimeControl, now: () => number = Date.now) {
    this.control = control
    this.now = now
    const initial = control.kind === 'timed' ? control.initialMs : 0
    this.remaining = { w: initial, b: initial }
  }

  private get isTimed(): boolean {
    return this.control.kind === 'timed'
  }

  private elapsed(): number {
    return this.running === null ? 0 : this.now() - this.startedAt
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Bank the running side's elapsed time back into `remaining`. */
  private settle(): void {
    if (this.running === null) return
    const side = this.running
    this.remaining[side] = Math.max(0, this.remaining[side] - this.elapsed())
    this.running = null
    this.clearTimer()
  }

  private scheduleFlag(): void {
    if (!this.isTimed || this.running === null) return
    const side = this.running
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.remaining[side] = 0
      this.running = null
      this.timer = null
      this.flagged = side
      for (const cb of this.flagCallbacks) cb(side)
    }, this.remaining[side])
  }

  start(side: Side): void {
    if (!this.isTimed || this.flagged !== null) return
    this.settle()
    this.running = side
    this.startedAt = this.now()
    this.scheduleFlag()
  }

  /** The side that just moved gets the increment; `side` starts thinking. */
  switchTo(side: Side): void {
    if (!this.isTimed || this.flagged !== null) return
    const mover = this.running
    this.settle()
    if (mover !== null && this.control.kind === 'timed') {
      this.remaining[mover] += this.control.incrementMs
    }
    this.running = side
    this.startedAt = this.now()
    this.scheduleFlag()
  }

  pause(): void {
    if (!this.isTimed || this.running === null) return
    this.pausedSide = this.running
    this.settle()
  }

  resume(): void {
    if (!this.isTimed || this.pausedSide === null || this.flagged !== null) return
    const side = this.pausedSide
    this.pausedSide = null
    this.running = side
    this.startedAt = this.now()
    this.scheduleFlag()
  }

  getState(): ClockState {
    const live = { ...this.remaining }
    if (this.running !== null) {
      live[this.running] = Math.max(0, live[this.running] - this.elapsed())
    }
    return {
      whiteMs: live.w,
      blackMs: live.b,
      running: this.running,
      flagged: this.flagged,
    }
  }

  onFlag(cb: (side: Side) => void): void {
    this.flagCallbacks.push(cb)
  }

  dispose(): void {
    this.clearTimer()
    this.flagCallbacks = []
  }
}
