import type { MatchConfig, MatchPhase } from '../../match/types'

export function Controls({
  phase,
  config,
  canUndo,
  canRedo,
  canResign,
  speed,
  hint,
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
  speed: number
  hint: { label: string; text: string; disabled: boolean; loading?: boolean }
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

  return (
    <div className="controls">
      {/* Task 2: undo/redo/flip/resign as a 2x2 grid — a 232px column has
          no room for a 4-wide row without truncating "Flip board". */}
      <div className="controls-grid">
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
      {/* Pause/Step side by side; Speed moves to its own full-width row
          below (see .speed-control). All three stay present-but-disabled
          outside engine modes — never hidden — so the layout doesn't jump. */}
      <div className="controls-grid">
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
      </div>
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
      <div className="controls-row hint-row">
        <button
          data-testid="hint"
          className={hint.loading ? 'hint-loading' : undefined}
          onClick={onHint}
          disabled={hint.disabled}
        >
          {hint.label}
        </button>
        {/* min-height reserved in app.css (.hint-row .hint-text) for ~2
            lines, so an arriving or clearing hint never resizes this
            card (see tests/e2e/above-the-fold.spec.ts for a measured
            regression test on .controls's own height). */}
        <span className="hint-text" data-testid="hint-text" aria-live="polite">
          {hint.text}
        </span>
      </div>
    </div>
  )
}
