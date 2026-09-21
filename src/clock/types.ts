export type TimeControl =
  | { kind: 'timed'; initialMs: number; incrementMs: number }
  | { kind: 'untimed' }

export interface ClockState {
  whiteMs: number
  blackMs: number
  running: 'w' | 'b' | null
  flagged: 'w' | 'b' | null
}

export const TIME_CONTROLS: readonly {
  id: string
  label: string
  control: TimeControl
}[] = [
  { id: 'bullet-1-0', label: 'Bullet 1+0', control: { kind: 'timed', initialMs: 60_000, incrementMs: 0 } },
  { id: 'bullet-2-1', label: 'Bullet 2+1', control: { kind: 'timed', initialMs: 120_000, incrementMs: 1_000 } },
  { id: 'blitz-3-2', label: 'Blitz 3+2', control: { kind: 'timed', initialMs: 180_000, incrementMs: 2_000 } },
  { id: 'blitz-5-3', label: 'Blitz 5+3', control: { kind: 'timed', initialMs: 300_000, incrementMs: 3_000 } },
  { id: 'rapid-10-5', label: 'Rapid 10+5', control: { kind: 'timed', initialMs: 600_000, incrementMs: 5_000 } },
  { id: 'rapid-15-10', label: 'Rapid 15+10', control: { kind: 'timed', initialMs: 900_000, incrementMs: 10_000 } },
  { id: 'classical-30-0', label: 'Classical 30+0', control: { kind: 'timed', initialMs: 1_800_000, incrementMs: 0 } },
  { id: 'untimed', label: 'No clock', control: { kind: 'untimed' } },
]
