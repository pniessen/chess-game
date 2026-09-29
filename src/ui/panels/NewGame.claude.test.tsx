import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { NewGame, type Mode } from './NewGame'
import { CLAUDE_MODELS } from '../../claude/models'

const noop = () => {}

function renderNewGame(opts: {
  mode?: Mode
  engineAvailable?: boolean
  claude?: Partial<NonNullable<ComponentProps<typeof NewGame>['claude']>> | null
}) {
  const onModeChange = vi.fn()
  const onWhite = vi.fn()
  const onBlack = vi.fn()
  const claude =
    opts.claude === null
      ? undefined
      : {
          white: 'opus' as const,
          black: 'haiku' as const,
          onWhiteChange: onWhite,
          onBlackChange: onBlack,
          budgetLeftUsd: 12.5 as number | null | undefined,
          ...opts.claude,
        }
  render(
    <NewGame
      mode={opts.mode ?? 'two-player'}
      level={1}
      timeControlId="blitz-5-3"
      color="white"
      engineAvailable={opts.engineAvailable ?? true}
      onModeChange={onModeChange}
      onLevelChange={noop}
      onTimeControlChange={noop}
      onColorChange={noop}
      onStart={noop}
      claude={claude}
    />,
  )
  return { onModeChange, onWhite, onBlack }
}

const optionTexts = () => [...screen.getByTestId('mode').querySelectorAll('option')].map((o) => o.textContent)
const claudeOption = () =>
  screen.getByTestId('mode').querySelector('option[value="claude-vs-claude"]') as HTMLOptionElement | null

describe('NewGame: Claude vs Claude', () => {
  // Red if the mode is offered on a build without the flag (App passes no `claude`).
  test('no Claude option when the app passes no claude (a public build)', () => {
    renderNewGame({ claude: null })
    expect(claudeOption()).toBeNull()
  })

  test('with the flag on: a fourth option, Claude vs Claude, that selects the mode', () => {
    const { onModeChange } = renderNewGame({})
    expect(optionTexts()).toEqual(['Two players', 'One player', 'Engine vs engine', 'Claude vs Claude'])
    fireEvent.change(screen.getByTestId('mode'), { target: { value: 'claude-vs-claude' } })
    expect(onModeChange).toHaveBeenCalledWith('claude-vs-claude')
  })

  // Red if Claude vs Claude can start with no Stockfish for its fallback moves.
  test('disabled like the other bot modes when the engine is unavailable', () => {
    renderNewGame({ engineAvailable: false })
    expect(claudeOption()!.disabled).toBe(true)
  })

  test('the model selects appear only in the Claude mode', () => {
    renderNewGame({ mode: 'zero-player' })
    expect(screen.queryByTestId('claude-white')).toBeNull()
    expect(screen.queryByTestId('claude-black')).toBeNull()
  })

  test('two selects list all four models by label and report changes', () => {
    const { onWhite, onBlack } = renderNewGame({ mode: 'claude-vs-claude' })
    const labels = Object.values(CLAUDE_MODELS).map((m) => m.label)
    for (const id of ['claude-white', 'claude-black']) {
      const texts = [...screen.getByTestId(id).querySelectorAll('option')].map((o) => o.textContent)
      expect(texts).toEqual(labels)
    }
    expect((screen.getByTestId('claude-white') as HTMLSelectElement).value).toBe('opus')
    expect((screen.getByTestId('claude-black') as HTMLSelectElement).value).toBe('haiku')
    fireEvent.change(screen.getByTestId('claude-white'), { target: { value: 'fable' } })
    fireEvent.change(screen.getByTestId('claude-black'), { target: { value: 'sonnet' } })
    expect(onWhite).toHaveBeenCalledWith('fable')
    expect(onBlack).toHaveBeenCalledWith('sonnet')
  })

  test('level, colour and time control are disabled (Claude games are untimed)', () => {
    renderNewGame({ mode: 'claude-vs-claude' })
    expect(screen.getByTestId('level')).toBeDisabled()
    expect(screen.getByTestId('color')).toBeDisabled()
    expect(screen.getByTestId('time-control')).toBeDisabled()
  })

  // opus 0.63 + haiku 0.14 = 0.77, / 1.5 = 0.51
  test('the estimate is the two reserves summed and divided by 1.5', () => {
    renderNewGame({ mode: 'claude-vs-claude' })
    expect(screen.getByTestId('claude-estimate')).toHaveTextContent('Estimated cost: $0.51')
  })

  test('the budget left this month, formatted to the cent', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { budgetLeftUsd: 12.5 } })
    expect(screen.getByTestId('claude-budget')).toHaveTextContent('Budget left this month: $12.50')
  })

  test('an unreadable budget says unavailable', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { budgetLeftUsd: null } })
    expect(screen.getByTestId('claude-budget')).toHaveTextContent('Budget left this month: unavailable')
  })

  test('while the budget is loading it says so', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { budgetLeftUsd: undefined } })
    expect(screen.getByTestId('claude-budget')).toHaveTextContent('Budget left this month: …')
  })

  // Red if Start stays live, or nothing says why, when the local server is
  // not running or has no key (the budget request failed).
  test('an unreadable budget shows the local-server hint and disables Start', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { budgetLeftUsd: null } })
    expect(screen.getByTestId('claude-unavailable-hint')).toHaveTextContent(
      'Start the local server (npm run server) with ANTHROPIC_API_KEY in .env',
    )
    expect(screen.getByTestId('new-game')).toBeDisabled()
  })

  test('a readable budget: no hint, Start enabled', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { budgetLeftUsd: 12.5 } })
    expect(screen.queryByTestId('claude-unavailable-hint')).toBeNull()
    expect(screen.getByTestId('new-game')).toBeEnabled()
  })

  test('while the budget is loading: no hint yet, Start enabled', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { budgetLeftUsd: undefined } })
    expect(screen.queryByTestId('claude-unavailable-hint')).toBeNull()
    expect(screen.getByTestId('new-game')).toBeEnabled()
  })

  // Only the Claude mode depends on the local server.
  test('in another mode an unreadable budget changes nothing', () => {
    renderNewGame({ mode: 'zero-player', claude: { budgetLeftUsd: null } })
    expect(screen.queryByTestId('claude-unavailable-hint')).toBeNull()
    expect(screen.getByTestId('new-game')).toBeEnabled()
  })
})
