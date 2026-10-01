import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { NewGame, type Mode } from './NewGame'
import { CLAUDE_MODELS, type Usage } from '../../claude/models'

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

  test('Jev is a seat option in both selects, after the Claude models', () => {
    const { onWhite } = renderNewGame({ mode: 'claude-vs-claude' })
    for (const id of ['claude-white', 'claude-black']) {
      const options = [...screen.getByTestId(id).querySelectorAll('option')]
      expect(options.at(-1)).toHaveValue('jev')
      expect(options.at(-1)).toHaveTextContent('TypeSafe Jev')
      expect(options.at(-1)).not.toBeDisabled()
    }
    fireEvent.change(screen.getByTestId('claude-white'), { target: { value: 'jev' } })
    expect(onWhite).toHaveBeenCalledWith('jev')
  })

  test('a model the server cannot seat is disabled and says which key it needs', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { models: ['fable', 'opus', 'sonnet', 'haiku'] } })
    for (const id of ['claude-white', 'claude-black']) {
      const jev = screen.getByTestId(id).querySelector('option[value="jev"]') as HTMLOptionElement
      expect(jev).toBeDisabled()
      expect(jev).toHaveTextContent('TypeSafe Jev (no TYPESAFE_API_KEY)')
      const opus = screen.getByTestId(id).querySelector('option[value="opus"]') as HTMLOptionElement
      expect(opus).not.toBeDisabled()
    }
    expect(screen.queryByTestId('claude-seat-hint')).toBeNull()
    expect(screen.getByTestId('new-game')).not.toBeDisabled()
  })

  test('with only a TypeSafe key the Claude models say they need ANTHROPIC_API_KEY', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { white: 'jev', black: 'jev', models: ['jev'] } })
    const opus = screen.getByTestId('claude-white').querySelector('option[value="opus"]') as HTMLOptionElement
    expect(opus).toBeDisabled()
    expect(opus).toHaveTextContent('Claude Opus 5.5 (no ANTHROPIC_API_KEY)')
    expect(screen.getByTestId('new-game')).not.toBeDisabled()
  })

  test('a seated model the server cannot seat disables Start and says why', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { white: 'jev', black: 'haiku', models: ['haiku'] } })
    expect(screen.getByTestId('claude-seat-hint')).toHaveTextContent(
      'TypeSafe Jev needs TYPESAFE_API_KEY on the local server (see README).',
    )
    expect(screen.getByTestId('new-game')).toBeDisabled()
  })

  test('an older server that lists no models leaves every option enabled', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { white: 'jev' } })
    const disabled = [...screen.getByTestId('claude-white').querySelectorAll('option')].filter((o) => o.disabled)
    expect(disabled).toEqual([])
    expect(screen.getByTestId('new-game')).not.toBeDisabled()
  })

  test('two selects list all five models by label and report changes', () => {
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

describe('NewGame: this month\'s usage per model', () => {
  const u = (costUsd: number, calls: number, ms: number, outputTokens: number): Usage => ({
    costUsd,
    ms,
    inputTokens: 0,
    outputTokens,
    calls,
  })

  test('models with calls, in list order, with calls and seconds per call; output tokens in the title', () => {
    renderNewGame({
      mode: 'claude-vs-claude',
      claude: {
        month: {
          byModel: { haiku: u(0.004, 1, 800, 40), fable: u(0.2345, 12, 46_800, 12_345), sonnet: u(0, 0, 0, 0) },
          earlierUsd: 0,
        },
      },
    })
    const line = screen.getByTestId('claude-month')
    expect(line).toHaveTextContent(/^This month: Fable \$0\.23 \(12 calls, 3\.9 s\/call\) · Haiku \$0\.00 \(1 call, 0\.8 s\/call\)$/)
    const parts = [...line.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
    const note = 'A call is one request to the model, retries included.'
    expect(parts).toEqual([`Fable 5.1: 12,345 output tokens. ${note}`, `Haiku 4.5: 40 output tokens. ${note}`])
  })

  test('dollars from before per-model tracking show as Earlier', () => {
    renderNewGame({
      mode: 'claude-vs-claude',
      claude: { month: { byModel: { opus: u(0.01, 2, 3000, 100) }, earlierUsd: 0.13 } },
    })
    expect(screen.getByTestId('claude-month')).toHaveTextContent(/^This month: Opus \$0\.01 \(2 calls, 1\.5 s\/call\) · Earlier: \$0\.13$/)
  })

  test('only Earlier when no model has calls', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { month: { byModel: {}, earlierUsd: 0.13 } } })
    expect(screen.getByTestId('claude-month')).toHaveTextContent(/^This month: Earlier: \$0\.13$/)
  })

  test('an empty month renders no line', () => {
    renderNewGame({ mode: 'claude-vs-claude', claude: { month: { byModel: {}, earlierUsd: 0 } } })
    expect(screen.queryByTestId('claude-month')).toBeNull()
  })
})
