import type { ClockState } from '../../clock/types'

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

export function Clocks({
  clock,
  orientation,
}: {
  clock: ClockState
  orientation: 'white' | 'black'
}) {
  const top = orientation === 'white' ? 'b' : 'w'
  const bottom = orientation === 'white' ? 'w' : 'b'
  const props = (side: 'w' | 'b') => ({
    label: side === 'w' ? 'White' : 'Black',
    ms: side === 'w' ? clock.whiteMs : clock.blackMs,
    running: clock.running === side,
    flagged: clock.flagged === side,
    testId: `clock-${side}`,
  })

  return (
    <div className="clocks" data-testid="clocks">
      <Side {...props(top)} />
      <Side {...props(bottom)} />
    </div>
  )
}
