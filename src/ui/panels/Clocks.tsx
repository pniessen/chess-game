import { useEffect, useState } from 'react'
import type { ClockState } from '../../clock/types'

/** How often the display re-reads the clock while a side is running. */
export const CLOCK_POLL_MS = 100

/** `m:ss`, or `m:ss.t` (tenths) once a side has under ten seconds left. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = clamped / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (clamped < 10_000) {
    const tenths = Math.floor((clamped % 1000) / 100)
    return `${minutes}:${pad(seconds)}.${tenths}`
  }
  return `${minutes}:${pad(seconds)}`
}

function Side({
  label,
  ms,
  running,
  flagged,
  testId,
}: {
  label: string
  ms: number
  running: boolean
  flagged: boolean
  testId: string
}) {
  const classes = ['clock', running ? 'running' : '', flagged ? 'flagged' : ''].filter(Boolean)
  return (
    <div className={classes.join(' ')}>
      <span className="clock-label">{label}</span>
      <span className="clock-time" data-testid={testId}>
        {formatClock(ms)}
      </span>
    </div>
  )
}

/**
 * The two clocks.
 *
 * `clock` is the controller snapshot's clock: correct about WHICH side is
 * running, but its times are frozen at the last emit (i.e. the last move).
 * While a side is running we therefore poll `readClock` — the controller's
 * fresh, timestamp-based `clockState()` — on a local interval, so the
 * display counts down without every tick going through the controller's
 * emit() (which would rebuild the snapshot and re-render the whole app).
 *
 * The interval runs ONLY while a clock is running: it is torn down on
 * pause, flag, game end, untimed games, and unmount. Each poll is a fresh
 * read computed from the side's start timestamp, never an accumulated count
 * of ticks, so a throttled or late interval can't make the clock drift.
 */
export function Clocks({
  clock,
  readClock,
  orientation,
}: {
  clock: ClockState
  /** A fresh read of the live clock; omit for a static display. */
  readClock?: () => ClockState
  orientation: 'white' | 'black'
}) {
  // A polled reading, tagged with the snapshot clock it was taken under: a
  // new snapshot (a move, a pause) makes any older polled reading moot.
  const [polled, setPolled] = useState<{ base: ClockState; state: ClockState } | null>(null)

  useEffect(() => {
    if (clock.running === null || !readClock) return
    const id = setInterval(() => setPolled({ base: clock, state: readClock() }), CLOCK_POLL_MS)
    return () => clearInterval(id)
  }, [clock, readClock])

  const shown = polled !== null && polled.base === clock ? polled.state : clock

  const top = orientation === 'white' ? 'b' : 'w'
  const bottom = orientation === 'white' ? 'w' : 'b'
  const props = (side: 'w' | 'b') => ({
    label: side === 'w' ? 'White' : 'Black',
    ms: side === 'w' ? shown.whiteMs : shown.blackMs,
    running: shown.running === side,
    flagged: shown.flagged === side,
    testId: `clock-${side}`,
  })

  return (
    <div className="clocks" data-testid="clocks">
      <Side {...props(top)} />
      <Side {...props(bottom)} />
    </div>
  )
}
