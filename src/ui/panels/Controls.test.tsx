import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Controls } from './Controls'
import type { MatchConfig, MatchPhase } from '../../match/types'

/**
 * Task 2: Controls moved into the 232px left column. Nothing about which
 * control is present or what it says changed — this file exists (there was
 * none before) to make the "disabled, not hidden" ruling executable:
 * Pause/Step/Speed must always render, and must be disabled outside engine
 * modes rather than removed, across every mode the match can be in.
 */

const HUMAN = { kind: 'human' } as const
const ENGINE = { kind: 'engine', level: 1 } as const
const UNTIMED = { kind: 'untimed' } as const

const twoPlayerConfig: MatchConfig = { white: HUMAN, black: HUMAN, timeControl: UNTIMED }
const onePlayerConfig: MatchConfig = { white: HUMAN, black: ENGINE, timeControl: UNTIMED }
const zeroPlayerConfig: MatchConfig = { white: ENGINE, black: ENGINE, timeControl: UNTIMED }

const twoPlayerPhase: MatchPhase = { kind: 'awaiting-human', side: 'w' }
const onePlayerPhase: MatchPhase = { kind: 'awaiting-human', side: 'w' }
const zeroPlayerPhase: MatchPhase = { kind: 'engine-thinking', side: 'w', requestId: 1 }
const pausedPhase: MatchPhase = { kind: 'paused' }
const finishedPhase: MatchPhase = {
  kind: 'finished',
  status: { kind: 'checkmate', winner: 'w' },
  reason: 'normal',
  winner: 'w',
}

const noop = () => {}
const baseHandlers = {
  onUndo: noop,
  onRedo: noop,
  onFlip: noop,
  onResign: noop,
  onHint: noop,
  onPause: noop,
  onResume: noop,
  onStep: noop,
  onSpeedChange: noop,
}

const baseHint = { label: 'Hint', text: '', disabled: false }

function renderControls(overrides: {
  phase: MatchPhase
  config: MatchConfig
  canUndo?: boolean
  canRedo?: boolean
  canResign?: boolean
  speed?: number
  hint?: typeof baseHint
}) {
  render(
    <Controls
      phase={overrides.phase}
      config={overrides.config}
      canUndo={overrides.canUndo ?? true}
      canRedo={overrides.canRedo ?? true}
      canResign={overrides.canResign ?? true}
      speed={overrides.speed ?? 500}
      hint={overrides.hint ?? baseHint}
      {...baseHandlers}
    />,
  )
}

describe('Controls — presence, test id and label of every control', () => {
  test('every control renders with its test id and visible label', () => {
    renderControls({ phase: twoPlayerPhase, config: twoPlayerConfig })

    expect(screen.getByTestId('undo')).toHaveTextContent('Undo')
    expect(screen.getByTestId('redo')).toHaveTextContent('Redo')
    expect(screen.getByTestId('flip')).toHaveTextContent('Flip board')
    expect(screen.getByTestId('resign')).toHaveTextContent('Resign')
    expect(screen.getByTestId('pause')).toHaveTextContent('Pause')
    expect(screen.getByTestId('step')).toHaveTextContent('Step')
    expect(screen.getByTestId('speed')).toBeInTheDocument()
    expect(screen.getByTestId('hint')).toHaveTextContent('Hint')
    expect(screen.getByTestId('hint-text')).toBeInTheDocument()
    expect(screen.getByTestId('hint-text')).toHaveAttribute('aria-live', 'polite')
  })

  test('Pause swaps its label to Resume while paused', () => {
    renderControls({ phase: pausedPhase, config: onePlayerConfig })
    expect(screen.getByTestId('pause')).toHaveTextContent('Resume')
  })

  test('undo/redo/resign reflect canUndo/canRedo/canResign', () => {
    renderControls({
      phase: twoPlayerPhase,
      config: twoPlayerConfig,
      canUndo: false,
      canRedo: false,
      canResign: false,
    })
    expect(screen.getByTestId('undo')).toBeDisabled()
    expect(screen.getByTestId('redo')).toBeDisabled()
    expect(screen.getByTestId('resign')).toBeDisabled()
    // Flip is never conditionally disabled.
    expect(screen.getByTestId('flip')).toBeEnabled()
  })

  test('hint reflects the disabled flag it is passed', () => {
    renderControls({
      phase: onePlayerPhase,
      config: onePlayerConfig,
      hint: { label: 'Hint', text: '', disabled: true },
    })
    expect(screen.getByTestId('hint')).toBeDisabled()
  })
})

describe('Controls — Pause/Step/Speed: present-but-disabled, never hidden', () => {
  test('two-player (no engine seat): all three present but disabled', () => {
    renderControls({ phase: twoPlayerPhase, config: twoPlayerConfig })
    expect(screen.getByTestId('pause')).toBeDisabled()
    expect(screen.getByTestId('step')).toBeDisabled()
    expect(screen.getByTestId('speed')).toBeDisabled()
  })

  test('one-player, awaiting-human: Pause and Speed enabled, Step disabled (not paused)', () => {
    renderControls({ phase: onePlayerPhase, config: onePlayerConfig })
    expect(screen.getByTestId('pause')).toBeEnabled()
    expect(screen.getByTestId('step')).toBeDisabled()
    expect(screen.getByTestId('speed')).toBeEnabled()
  })

  test('zero-player, engine-thinking: Pause and Speed enabled, Step disabled (not paused)', () => {
    renderControls({ phase: zeroPlayerPhase, config: zeroPlayerConfig })
    expect(screen.getByTestId('pause')).toBeEnabled()
    expect(screen.getByTestId('step')).toBeDisabled()
    expect(screen.getByTestId('speed')).toBeEnabled()
  })

  test('paused: Pause (now "Resume"), Step and Speed all enabled', () => {
    renderControls({ phase: pausedPhase, config: onePlayerConfig })
    expect(screen.getByTestId('pause')).toBeEnabled()
    expect(screen.getByTestId('step')).toBeEnabled()
    expect(screen.getByTestId('speed')).toBeEnabled()
  })

  test('paused with no engine seat: still disabled — pausing a two-player game makes no sense', () => {
    renderControls({ phase: pausedPhase, config: twoPlayerConfig })
    expect(screen.getByTestId('pause')).toBeDisabled()
    expect(screen.getByTestId('step')).toBeDisabled()
    expect(screen.getByTestId('speed')).toBeDisabled()
  })

  test('finished: all three present but disabled, even with an engine seat', () => {
    renderControls({ phase: finishedPhase, config: onePlayerConfig })
    expect(screen.getByTestId('pause')).toBeDisabled()
    expect(screen.getByTestId('step')).toBeDisabled()
    expect(screen.getByTestId('speed')).toBeDisabled()
  })

  test('finished: all three still render (present, not removed)', () => {
    renderControls({ phase: finishedPhase, config: zeroPlayerConfig })
    expect(screen.getByTestId('pause')).toBeInTheDocument()
    expect(screen.getByTestId('step')).toBeInTheDocument()
    expect(screen.getByTestId('speed')).toBeInTheDocument()
  })
})

describe('Controls — every mode keeps every other control present too', () => {
  const modes: { name: string; phase: MatchPhase; config: MatchConfig }[] = [
    { name: 'two-player', phase: twoPlayerPhase, config: twoPlayerConfig },
    { name: 'one-player', phase: onePlayerPhase, config: onePlayerConfig },
    { name: 'zero-player', phase: zeroPlayerPhase, config: zeroPlayerConfig },
    { name: 'paused', phase: pausedPhase, config: onePlayerConfig },
    { name: 'finished', phase: finishedPhase, config: twoPlayerConfig },
  ]

  for (const { name, phase, config } of modes) {
    test(`${name}: undo, redo, flip, resign and hint all render`, () => {
      renderControls({ phase, config })
      for (const id of ['undo', 'redo', 'flip', 'resign', 'hint']) {
        expect(screen.getByTestId(id)).toBeInTheDocument()
      }
    })
  }
})
