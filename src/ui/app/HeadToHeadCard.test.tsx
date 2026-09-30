import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { HeadToHead } from '../../claude/models'
import { HeadToHeadCard, headToHeadText } from './HeadToHeadCard'
import { Scoreboard } from '../panels/Scoreboard'

const rec = (r: Partial<HeadToHead>): HeadToHead => ({
  games: 0,
  whiteModelWins: 0,
  blackModelWins: 0,
  draws: 0,
  whiteWins: 0,
  blackWins: 0,
  ...r,
})

describe('headToHeadText', () => {
  test('the current White model first, then its opponent, then the draws', () => {
    const r = rec({ games: 3, whiteModelWins: 2, blackModelWins: 1, draws: 0, whiteWins: 1, blackWins: 2 })
    expect(headToHeadText(r, 'sonnet', 'haiku')).toBe('Sonnet 5.5 2 – 1 Haiku 4.5 · 0 draws')
  })

  test('one draw is singular', () => {
    expect(headToHeadText(rec({ games: 1, draws: 1 }), 'opus', 'fable')).toBe('Opus 5.5 0 – 0 Fable 5.1 · 1 draw')
  })

  test('a mirror match reads by colour, labelled with the model', () => {
    const r = rec({ games: 3, whiteWins: 1, blackWins: 0, draws: 2, whiteModelWins: 1 })
    expect(headToHeadText(r, 'haiku', 'haiku')).toBe('Haiku 4.5 vs itself: White 1 – 0 Black · 2 draws')
  })

  test('loading (undefined) or unreadable (null) is a dash', () => {
    expect(headToHeadText(undefined, 'sonnet', 'haiku')).toBe('—')
    expect(headToHeadText(null, 'sonnet', 'haiku')).toBe('—')
  })
})

describe('the Score card', () => {
  test('in a Claude game: "Head to head" and the record', () => {
    render(<HeadToHeadCard record={rec({ games: 1, whiteModelWins: 1, whiteWins: 1 })} white="sonnet" black="haiku" />)
    expect(screen.getByText('Head to head')).toBeInTheDocument()
    expect(screen.getByTestId('claude-record')).toHaveTextContent('Sonnet 5.5 1 – 0 Haiku 4.5 · 0 draws')
    expect(screen.queryByText('Score')).toBeNull()
  })

  test('in a Claude game while loading: a dash', () => {
    render(<HeadToHeadCard record={undefined} white="sonnet" black="haiku" />)
    expect(screen.getByTestId('claude-record')).toHaveTextContent('—')
  })

  test('in any other game: the human W–L–D, unchanged', () => {
    render(<Scoreboard score={{ wins: 2, losses: 1, draws: 3 }} />)
    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getByTestId('scoreboard')).toHaveTextContent('2–1–3')
    expect(screen.queryByTestId('claude-record')).toBeNull()
  })
})
