import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Controls } from './Controls'
import type { MatchConfig, MatchPhase } from '../../match/types'

const noop = () => {}
const CLAUDE: MatchConfig = {
  white: { kind: 'claude', model: 'opus' },
  black: { kind: 'claude', model: 'haiku' },
  timeControl: { kind: 'untimed' },
}

function renderControls(phase: MatchPhase) {
  render(
    <Controls
      phase={phase}
      config={CLAUDE}
      canUndo
      canRedo
      canResign={false}
      speed={500}
      hint={{ label: 'Hint', text: '', disabled: true }}
      onUndo={noop}
      onRedo={noop}
      onFlip={noop}
      onResign={noop}
      onHint={noop}
      onPause={noop}
      onResume={noop}
      onStep={noop}
      onSpeedChange={noop}
    />,
  )
}

// Red while Controls only counts engine seats as bots.
describe('Controls in Claude vs Claude', () => {
  test('thinking: Pause and Speed enabled', () => {
    renderControls({ kind: 'engine-thinking', side: 'w', requestId: 1 })
    expect(screen.getByTestId('pause')).toBeEnabled()
    expect(screen.getByTestId('speed')).toBeEnabled()
  })

  test('paused: Resume and Step enabled', () => {
    renderControls({ kind: 'paused' })
    expect(screen.getByTestId('pause')).toHaveTextContent('Resume')
    expect(screen.getByTestId('pause')).toBeEnabled()
    expect(screen.getByTestId('step')).toBeEnabled()
  })
})
