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
          available: true,
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
  // Red if the mode is offered without an owner token.
  test('no Claude option without a token (or on a build without coaching)', () => {
    renderNewGame({ claude: null })
    expect(claudeOption()).toBeNull()
  })

  test('no Claude option when a token is not set', () => {
    renderNewGame({ claude: { available: false } })
    expect(claudeOption()).toBeNull()
  })

  test('with a token: a fourth option, Claude vs Claude, that selects the mode', () => {
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

  // opus 0.87 + haiku 0.06 = 0.93, / 1.5 = 0.62
  test('the estimate is the two reserves summed and divided by 1.5', () => {
    renderNewGame({ mode: 'claude-vs-claude' })
    expect(screen.getByTestId('claude-estimate')).toHaveTextContent('Estimated cost: $0.62')
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

  // A resumed Claude game after the token was cleared still names its mode.
  test('the option stays (disabled) while the panel shows a Claude game with no token', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { available: false } })
    expect(claudeOption()).not.toBeNull()
    expect(claudeOption()!.disabled).toBe(true)
  })
})
