import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Promotion } from './Promotion'

describe('Promotion', () => {
  test('offers queen, rook, bishop and knight', () => {
    render(<Promotion color="w" onChoose={vi.fn()} onCancel={vi.fn()} />)
    for (const name of ['Queen', 'Rook', 'Bishop', 'Knight']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  test('choosing reports the piece symbol', () => {
    const onChoose = vi.fn()
    render(<Promotion color="w" onChoose={onChoose} onCancel={vi.fn()} />)
    screen.getByRole('button', { name: 'Knight' }).click()
    expect(onChoose).toHaveBeenCalledWith('n')
  })
})
