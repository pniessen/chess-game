import type { MatchConfig, MatchPhase } from '../../match/types'

export function Controls({
  phase,
  config,
  canUndo,
  canRedo,
  canResign,
  engineAvailable,
  speed,
  hintText,
  hintPending,
  onUndo,
  onRedo,
  onFlip,
  onResign,
  onHint,
  onPause,
  onResume,
  onStep,
  onSpeedChange,
}: {
  phase: MatchPhase
  config: MatchConfig
  canUndo: boolean
  canRedo: boolean
  canResign: boolean
  engineAvailable: boolean
  speed: number
  hintText: string
  hintPending: boolean
  onUndo: () => void
  onRedo: () => void
  onFlip: () => void
  onResign: () => void
  onHint: () => void
  onPause: () => void
  onResume: () => void
  onStep: () => void
  onSpeedChange: (ms: number) => void
}) {
  const hasEngineSeat = config.white.kind === 'engine' || config.black.kind === 'engine'
  const isPaused = phase.kind === 'paused'
  const isRunning = phase.kind === 'engine-thinking' || phase.kind === 'awaiting-human'
  // Disable what does not apply rather than hide it, so the layout doesn't jump.
  const pauseDisabled = !hasEngineSeat || !(isPaused || isRunning)
  const stepDisabled = !hasEngineSeat || !isPaused
  const speedDisabled = !hasEngineSeat || phase.kind === 'finished' || phase.kind === 'idle'
  const hintDisabled = !engineAvailable || phase.kind !== 'awaiting-human' || hintPending

  return (
    <div className="controls">
      <div className="controls-row">
        <button data-testid="undo" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
        <button data-testid="redo" onClick={onRedo} disabled={!canRedo}>
          Redo
        </button>
        <button data-testid="flip" onClick={onFlip}>
          Flip board
        </button>
        <button data-testid="resign" onClick={onResign} disabled={!canResign}>
          Resign
        </button>
      </div>
      <div className="controls-row">
        <button
          data-testid="pause"
          onClick={isPaused ? onResume : onPause}
          disabled={pauseDisabled}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button data-testid="step" onClick={onStep} disabled={stepDisabled}>
          Step
        </button>
        <label className="speed-control">
          Speed
          <input
            type="range"
            data-testid="speed"
            min={0}
            max={2000}
            step={100}
            value={speed}
            disabled={speedDisabled}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="controls-row hint-row">
        <button data-testid="hint" onClick={onHint} disabled={hintDisabled}>
          {hintPending ? 'Thinking…' : 'Hint'}
        </button>
        <span className="hint-text" data-testid="hint-text">
          {hintText}
        </span>
      </div>
    </div>
  )
}
